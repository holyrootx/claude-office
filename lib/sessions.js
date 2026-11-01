// 세션 기록 파일을 찾고 따라 읽어서 화면(SSE)마다 보내는 부분:
// 세션 목록, 권한 확인 대기(hooks), 파일 따라 읽기(Tail·Session), 화면별 추적(Follower), 다시 보기.
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {
  PROJECTS, POLL_MS, HISTORY_EVENTS, MAX_INITIAL_BYTES, ALL_INITIAL_BYTES, SUB_INITIAL_BYTES, ACTIVE_MS, SUB_IDLE_MS, MAX_SESSIONS,
} = require('./config');
const { roomOf, ASK_TOOLS, contextWindow, clip, baseName, displayName, labelOf, detailOf, Normalizer } = require('./normalize');

// ───────────────────────── 세션 파일 목록 ─────────────────────────
function readRange(file, start, end) {
  const len = Math.max(0, end - start);
  const buf = Buffer.alloc(len);
  if (!len) return buf;
  const fd = fs.openSync(file, 'r');
  try {
    let got = 0;
    while (got < len) {
      const n = fs.readSync(fd, buf, got, len - got, start + got);
      if (!n) break;
      got += n;
    }
    return got === len ? buf : buf.subarray(0, got);
  } finally {
    fs.closeSync(fd);
  }
}

function scanSessions() {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { return out; }
  for (const d of dirs) {
    const dir = path.join(PROJECTS, d.name);
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const file = path.join(dir, f);
      try {
        const st = fs.statSync(file);
        out.push({ file, mtime: st.mtimeMs, size: st.size, dir: d.name });
      } catch { /* 지워진 파일 */ }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

const metaCache = new Map();
function describe(s) {
  const hit = metaCache.get(s.file);
  if (hit && hit.mtime === s.mtime) return hit;
  let title = '', prompt = '', cwd = '';
  const st = { size: s.size };
  const tail = readRange(s.file, Math.max(0, st.size - 256 * 1024), st.size).toString('utf8').split('\n');
  for (let i = tail.length - 1; i >= 0 && !(title && cwd); i--) {
    const l = tail[i];
    if (l.charCodeAt(0) !== 123) continue;
    let j;
    try { j = JSON.parse(l); } catch { continue; }
    if (!title && j.type === 'custom-title' && j.customTitle) title = j.customTitle;
    if (!title && j.type === 'summary' && j.summary) title = j.summary;
    if (!prompt && j.type === 'last-prompt' && j.lastPrompt) prompt = j.lastPrompt;
    if (!cwd && j.cwd) cwd = j.cwd;
  }
  const d = {
    file: s.file,
    id: path.basename(s.file, '.jsonl'),
    mtime: s.mtime,
    size: s.size,
    title: clip(title || prompt || '(제목 없음)', 70),
    project: cwd ? baseName(cwd) : s.dir,
    cwd,
  };
  metaCache.set(s.file, d);
  return d;
}

function insideProjects(file) {
  const rel = path.relative(PROJECTS, path.resolve(file));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) && rel.endsWith('.jsonl');
}

// ───────────────────────── 권한 확인 대기 (hooks) ─────────────────────────
// 권한 확인 창이 떠 있다는 사실은 세션 기록에 남지 않아서, Claude Code hook(hooks/notify.js)이 알려 준 것을 따로 들고 있다.
// 세션 id → { kind: 'permission'|'input', ts, match, agentId, name, tool, room, label, detail, text, id, on }
//   id: 기다리는 도구의 tool_use id · on: 대기를 보여 줄 캐릭터 ('' = 메인, 아니면 서브에이전트 id)
const waits = new Map();
const followers = new Set();
const ENDS_WAIT = new Set(['user', 'turn_end', 'interrupt', 'compact']);
const waitKey = w => (w ? `${w.ts}|${w.id || ''}|${w.on || ''}` : '');
const isFinal = e => e.k === 'say' && e.final;

function onHook(h) {
  const sid = String(h.session_id || '');
  if (!sid) return;
  const agentId = h.agent_id ? String(h.agent_id) : '';
  let w = null;
  switch (h.hook_event_name) {
    case 'PermissionRequest': {
      const name = String(h.tool_name || '');
      if (!name || ASK_TOOLS.has(name)) return;
      const input = h.tool_input || {};
      w = {
        kind: 'permission', ts: Date.now(), match: [name], agentId, agent: !!agentId,
        name, tool: displayName(name), room: roomOf(name), label: labelOf(name, input), detail: detailOf(name, input),
      };
      break;
    }
    case 'Notification': {
      // 권한 확인 창이 6초쯤 그대로면 오는 알림. PermissionRequest를 못 받았을 때만 쓴다.
      const t = h.notification_type;
      if (waits.has(sid) || (t !== 'permission_prompt' && t !== 'elicitation_dialog')) return;
      w = { kind: t === 'permission_prompt' ? 'permission' : 'input', ts: Date.now(), match: [], agentId, agent: !!agentId, text: clip(h.message, 120) };
      break;
    }
    case 'SessionEnd':
      if (!waits.delete(sid)) return;
      break;
    default:
      return;
  }
  if (w) waits.set(sid, w);
  let file = null;
  if (w) for (const f of followers) if (f.mode !== 'file' && !f.sessions.has(sid)) { file = findSession(sid); break; }
  for (const f of followers) f.hook(sid, file);
}

function findSession(sid) {
  const s = scanSessions().find(x => path.basename(x.file, '.jsonl') === sid);
  return s ? s.file : null;
}

// 빌딩에 보일 세션: 최근 30분 안에 움직였거나 권한을 기다리는 세션 (하나도 없으면 가장 최근 하나)
function activeFiles() {
  const all = scanSessions();
  const pick = all.filter(s => Date.now() - s.mtime < ACTIVE_MS || waits.has(path.basename(s.file, '.jsonl'))).slice(0, MAX_SESSIONS);
  return (pick.length ? pick : all.slice(0, 1)).map(s => s.file);
}

// ───────────────────────── 기록 파일 따라 읽기 ─────────────────────────
// 파일 하나(메인 세션 또는 서브에이전트)를 끝까지 읽어 두고, 그 뒤로 붙는 줄만 이벤트로 바꾼다.
class Tail {
  constructor(file, opts) {
    this.file = file;
    this.norm = new Normalizer(opts);
    this.offset = 0;
    this.rest = Buffer.alloc(0);
    this.mtime = 0;
    this.size = 0;
    this.lastGrow = 0;
  }

  // 처음 붙을 때: 끝에서 maxBytes까지 읽어 지난 이벤트를 만든다. 파일이 없으면 null.
  load(maxBytes) {
    let st;
    try { st = fs.statSync(this.file); } catch { return null; }
    const start = Math.max(0, st.size - maxBytes);
    const buf = readRange(this.file, start, st.size);
    const nl = buf.lastIndexOf(0x0a);
    this.rest = Buffer.from(buf.subarray(nl + 1));
    this.offset = start + buf.length;
    this.mtime = this.lastGrow = st.mtimeMs;
    this.size = st.size;
    // 파일이 커서 읽지 않고 건너뛴 앞부분 (바이트). 경계에서 잘린 줄은 뒤쪽이 버리니까 앞부분에 넣는다.
    this.skipped = start > 0 ? start + buf.indexOf(0x0a) + 1 : 0;
    const lines = nl >= 0 ? buf.subarray(0, nl).toString('utf8').split('\n') : [];
    if (start > 0) lines.shift();
    return this.parse(lines);
  }

  // 지난번 이후 새로 붙은 줄. 파일이 줄어들었으면(다시 쓰임) null.
  more() {
    let st;
    try { st = fs.statSync(this.file); } catch { return []; }
    if (st.size < this.offset) return null;
    if (st.size === this.offset) return [];
    const buf = readRange(this.file, this.offset, st.size);
    this.offset += buf.length;
    this.size = st.size;
    this.mtime = st.mtimeMs;
    this.lastGrow = Date.now();
    const data = this.rest.length ? Buffer.concat([this.rest, buf]) : buf;
    const nl = data.lastIndexOf(0x0a);
    if (nl < 0) { this.rest = Buffer.from(data); return []; }
    this.rest = Buffer.from(data.subarray(nl + 1));
    return this.parse(data.subarray(0, nl).toString('utf8').split('\n'));
  }

  parse(lines) {
    const out = [];
    for (const l of lines) for (const e of this.norm.line(l)) out.push(e);
    return out;
  }
}

// 세션 하나 = 메인 기록 + 서브에이전트 기록들(<세션id>/subagents/agent-*.jsonl)
class Session {
  constructor(file, maxBytes) {
    this.file = file;
    this.sid = path.basename(file, '.jsonl');
    this.subDir = path.join(path.dirname(file), this.sid, 'subagents');
    this.maxBytes = maxBytes;
    this.main = new Tail(file);
    this.subs = new Map(); // 서브에이전트 id → { tail, info }
    this.waitKey = '';
  }

  // 화면에 처음 보낼 모습. 파일을 못 읽으면 null.
  snapshot() {
    const events = this.main.load(this.maxBytes);
    if (!events) return null;
    if (this.main.skipped > 0) this.countHead(this.main.skipped);
    const agents = [];
    const subEvents = new Map();
    for (const { a, evs } of this.findAgents()) {
      subEvents.set(a.info.id, evs);
      // 끝났거나 오래 조용한 서브에이전트는 빼고, 지금 일하는 인턴만 보낸다
      const last = evs[evs.length - 1];
      if (!last || isFinal(last) || Date.now() - a.tail.mtime > SUB_IDLE_MS) continue;
      agents.push({ ...a.info, history: evs.slice(-40).map(e => ({ ...e, agent: a.info.id })) });
    }
    const wait = this.checkWait(events, subEvents);
    this.waitKey = waitKey(wait);
    const st = { file: this.file, mtime: this.main.mtime, size: this.main.size, dir: baseName(path.dirname(this.file)) };
    return {
      sid: this.sid,
      session: { ...describe(st), ...this.metaOut() },
      history: events.slice(-HISTORY_EVENTS),
      plan: this.main.norm.plan,
      stats: this.stats(),
      wait,
      agents,
    };
  }

  // 새로 생긴 서브에이전트 기록 파일을 등록하고 읽어 둔다 (meta.json에 종류·설명·부모 도구 id가 있다)
  findAgents() {
    const found = [];
    let names;
    try { names = fs.readdirSync(this.subDir); } catch { return found; }
    for (const f of names) {
      const m = f.match(/^agent-(.+)\.jsonl$/);
      if (!m || this.subs.has(m[1])) continue;
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(this.subDir, `agent-${m[1]}.meta.json`), 'utf8')); } catch { /* 메타 없음 */ }
      const a = {
        tail: new Tail(path.join(this.subDir, f), { sidechain: true }),
        info: { id: m[1], type: clip(meta.agentType, 30), desc: clip(meta.description, 60), parent: String(meta.toolUseId || '') },
      };
      this.subs.set(m[1], a);
      found.push({ a, evs: a.tail.load(SUB_INITIAL_BYTES) || [] });
    }
    return found;
  }

  // 새 줄을 읽어 화면에 보낼 변화. 변화가 없으면 null, 파일이 다시 쓰였으면 'reset'.
  poll(tick, force) {
    const main = this.main.more();
    if (!main) return 'reset';
    const events = main.slice();
    const subEvents = new Map();
    if (force || tick % 8 === 0) {
      for (const { a, evs } of this.findAgents()) {
        subEvents.set(a.info.id, evs);
        // 새 인턴: 소개 이벤트 다음에 지금까지 한 일을 붙인다
        events.push({ k: 'agent', ts: Date.now(), agent: a.info.id, type: a.info.type, desc: a.info.desc, parent: a.info.parent });
        for (const e of evs.slice(-40)) events.push({ ...e, agent: a.info.id });
      }
    }
    for (const [id, a] of this.subs) {
      const evs = a.tail.more();
      if (evs === null) { a.tail.load(SUB_INITIAL_BYTES); continue; }
      if (!evs.length) continue;
      subEvents.set(id, (subEvents.get(id) || []).concat(evs));
      for (const e of evs) events.push({ ...e, agent: id });
    }
    const wait = this.checkWait(main, subEvents);
    const key = waitKey(wait);
    if (!events.length && !force && key === this.waitKey && !this.statsDirty) return null;
    this.waitKey = key;
    this.statsDirty = false;
    return { sid: this.sid, events, plan: this.main.norm.plan, stats: this.stats(), meta: this.metaOut(), wait };
  }

  // 이 세션의 권한 대기. 기다리는 도구를 기록에서 찾아 id를 붙이고, 이미 끝난 대기는 지운다.
  checkWait(mainEvents, subEvents) {
    const w = waits.get(this.sid);
    if (!w) return null;
    if (!w.id) {
      const sub = w.agentId && this.subs.get(w.agentId);
      if (sub) {
        w.id = sub.tail.norm.openTool(w.match, w.label);
        w.on = w.agentId;
      } else {
        // 서브에이전트 기록을 아직 못 찾았으면 메인 세션에서 실행 중인 Agent 도구에 붙인다
        w.id = this.main.norm.openTool(w.agentId ? ['Agent', 'Task'] : w.match, w.agentId ? '' : w.label);
        w.on = '';
      }
    }
    // 다른 화면이 먼저 찾은 서브에이전트일 수 있으니, 없으면 한 번 더 찾아본다
    const sub = w.on && (this.subs.get(w.on) || (this.findAgents(), this.subs.get(w.on)));
    const norm = sub ? sub.tail.norm : this.main.norm;
    const events = w.on ? subEvents.get(w.on) || [] : mainEvents;
    const t = w.id && norm.tools.get(w.id);
    const moved = events.some(e => e.ts >= w.ts && (ENDS_WAIT.has(e.k) || isFinal(e)));
    // 기다린다는 도구가 3초가 지나도 기록에 없으면 이미 끝난 대기로 본다
    if ((t && t.done) || moved || (!w.id && Date.now() - w.ts > 3000)) {
      waits.delete(this.sid);
      return null;
    }
    return w;
  }

  // 마지막으로 기록이 늘어난 시각 (메인과 서브에이전트 중 가장 늦은 것)
  lastActive() {
    return Math.max(this.main.mtime, ...[...this.subs.values()].map(a => a.tail.mtime));
  }

  // 방별 사용량은 서브에이전트가 쓴 도구까지 합친다
  // 화면은 파일 끝부분만 읽고 바로 띄우고, 건너뛴 앞부분의 사용량은 줄 단위로 흘려 읽으며 따로 센다.
  // 다 세면 다음 갱신 때 합친 숫자를 보낸다 (그동안 다른 화면의 실시간 추적은 멈추지 않는다).
  countHead(end) {
    const norm = new Normalizer();
    const rl = readline.createInterface({ input: fs.createReadStream(this.file, { encoding: 'utf8', start: 0, end: end - 1 }), crlfDelay: Infinity });
    (async () => {
      for await (const l of rl) {
        if (this.closed) return rl.close();
        norm.line(l);
      }
      this.headStats = norm.stats;
      this.statsDirty = true;
    })().catch(() => {});
  }

  stats() {
    const s = { ...this.main.norm.stats };
    if (this.headStats) for (const k in s) s[k] += this.headStats[k] || 0;
    for (const a of this.subs.values()) {
      for (const k of ['library', 'dev', 'server', 'search', 'meeting', 'desk', 'tools', 'errors']) s[k] += a.tail.norm.stats[k];
    }
    return s;
  }

  metaOut() {
    const m = this.main.norm.meta;
    const out = { model: m.model, branch: m.branch };
    if (m.title) out.title = clip(m.title, 70);
    if (m.cwd) { out.cwd = m.cwd; out.project = baseName(m.cwd); }
    const ctx = this.main.norm.ctx;
    if (ctx) out.ctx = { tokens: ctx, window: contextWindow(m.model, ctx) };
    return out;
  }
}

// ───────────────────────── 화면(SSE 연결)마다 ─────────────────────────
// mode: 'all' 최근에 움직인 세션 전부(빌딩) · 'auto' 가장 최근 세션 하나 · 'file' 고른 세션 하나
class Follower {
  constructor(res, want) {
    this.res = res;
    this.mode = want === 'all' || want === 'auto' ? want : 'file';
    this.pinned = this.mode === 'file' ? want : null;
    this.sessions = new Map();
    this.tick = 0;
    this.lastWrite = Date.now();
    followers.add(this);
    const first = this.mode === 'all' ? activeFiles() : [this.pinned || (scanSessions()[0] || {}).file].filter(Boolean);
    this.hello(first);
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  send(event, data) {
    this.lastWrite = Date.now();
    this.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  // 보여 줄 세션을 새로 정하고 처음부터 다시 그리게 한다
  hello(files) {
    for (const s of this.sessions.values()) s.closed = true;
    this.sessions.clear();
    const snaps = files.map(f => this.open(f)).filter(Boolean);
    this.send('hello', { mode: this.mode, root: PROJECTS, sessions: snaps });
  }

  open(file) {
    const s = new Session(file, this.mode === 'all' ? ALL_INITIAL_BYTES : MAX_INITIAL_BYTES);
    const snap = s.snapshot();
    if (!snap) return null;
    const old = this.sessions.get(s.sid);
    if (old) old.closed = true; // 다시 읽어 바꾸는 경우
    this.sessions.set(s.sid, s);
    return snap;
  }

  // 빌딩에 세션 하나를 더한다 (이미 있으면 다시 읽어 바꾼다)
  join(file) {
    const snap = this.open(file);
    if (snap) this.send('join', snap);
    // 너무 많으면 가장 오래 조용한 세션부터 뺀다 (권한을 기다리는 세션은 남긴다)
    const quiet = [...this.sessions.values()].filter(s => !waits.has(s.sid)).sort((a, b) => a.main.lastGrow - b.main.lastGrow);
    while (this.sessions.size > MAX_SESSIONS && quiet.length) {
      const s = quiet.shift();
      s.closed = true;
      this.sessions.delete(s.sid);
      this.send('leave', { sid: s.sid });
    }
  }

  poll() {
    this.tick++;
    try {
      if (this.tick % 8 === 0) this.discover();
      const updates = [];
      for (const s of [...this.sessions.values()]) {
        const u = s.poll(this.tick, false);
        if (u === 'reset') this.join(s.file);
        else if (u) updates.push(u);
      }
      if (updates.length) this.send('events', { updates });
      if (Date.now() - this.lastWrite > 15000) { this.res.write(': ping\n\n'); this.lastWrite = Date.now(); }
    } catch (e) {
      console.error('[poll]', e.message);
    }
  }

  discover() {
    if (this.mode === 'all') {
      for (const f of activeFiles()) if (!this.sessions.has(path.basename(f, '.jsonl'))) this.join(f);
      // 오래 조용한 직원은 퇴근한다. 권한을 기다리는 직원과, 빌딩이 텅 비지 않게 마지막 한 명은 남긴다.
      const quiet = [...this.sessions.values()]
        .filter(s => !waits.has(s.sid) && Date.now() - s.lastActive() > ACTIVE_MS)
        .sort((a, b) => a.lastActive() - b.lastActive());
      while (quiet.length && this.sessions.size > 1) {
        const s = quiet.shift();
        s.closed = true;
      this.sessions.delete(s.sid);
        this.send('leave', { sid: s.sid });
      }
    } else if (this.mode === 'auto') {
      const cur = [...this.sessions.values()][0];
      if (cur && waits.has(cur.sid)) return; // 내 답을 기다리는 세션에서는 떠나지 않는다
      const newest = scanSessions()[0];
      if (!newest || (cur && newest.file === cur.file)) return;
      // 다른 세션이 방금 기록됐고, 지금 세션은 4초 이상 조용하면 갈아탄다.
      if (!cur || (Date.now() - newest.mtime < 5000 && Date.now() - cur.main.lastGrow > 4000)) this.hello([newest.file]);
    }
  }

  // hook이 알려 온 일. 보고 있는 세션이면 바로 다시 읽고, 아니면 권한을 기다리는 세션을 데려온다.
  hook(sid, file) {
    const s = this.sessions.get(sid);
    if (s) {
      const u = s.poll(this.tick, true);
      if (u === 'reset') this.join(s.file);
      else if (u) this.send('events', { updates: [u] });
    } else if (file && this.mode === 'all') this.join(file);
    else if (file && this.mode === 'auto') this.hello([file]);
  }

  close() {
    clearInterval(this.timer);
    followers.delete(this);
    for (const s of this.sessions.values()) s.closed = true;
  }
}

// ───────────────────────── 다시 보기 ─────────────────────────
// 세션 하나의 처음부터 끝까지를 시간 순으로 (서브에이전트가 한 일과 출근 소개까지 섞어서)
// 다시 보기는 파일을 처음부터 끝까지 읽는다. 수백 MB짜리 세션도 있어서, 한 번에 읽지 않고 줄 단위로 흘려 읽어
// 그동안 다른 화면의 실시간 추적이 멈추지 않게 한다. 이벤트가 너무 많으면 앞부분을 빼고 몇 개를 뺐는지 알려 준다.
const REPLAY_MAX_EVENTS = 30000;
async function readAllEvents(file, norm) {
  const out = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const l of rl) for (const e of norm.line(l)) out.push(e);
  return out;
}
async function replayOf(file) {
  const s = new Session(file, MAX_INITIAL_BYTES);
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const all = await readAllEvents(file, s.main.norm);
  for (const { a, evs } of s.findAgents()) {
    if (!evs.length) continue;
    all.push({ k: 'agent', ts: evs[0].ts - 1, agent: a.info.id, type: a.info.type, desc: a.info.desc, parent: a.info.parent });
    for (const e of evs) all.push({ ...e, agent: a.info.id });
  }
  all.sort((x, y) => x.ts - y.ts); // 같은 시각이면 원래 순서를 지킨다
  const meta = s.metaOut();
  delete meta.ctx; // 끝났을 때의 컨텍스트라 다시 보기 중에는 맞지 않는다
  const desc = describe({ file, mtime: st.mtimeMs, size: st.size, dir: baseName(path.dirname(file)) });
  const skipped = Math.max(0, all.length - REPLAY_MAX_EVENTS);
  return { sid: s.sid, session: { ...desc, ...meta }, total: all.length, skipped, events: skipped ? all.slice(skipped) : all };
}

// ───────────────────────── 업무 일지 ─────────────────────────
// 오늘(자정 이후) 움직인 세션을 프로젝트별로 모아서 정리한다.
// 일한 시간은 기록 사이 간격이 5분보다 짧은 것만 더한다 (그보다 길면 쉬었다고 본다).
const JOURNAL_GAP_MS = 5 * 60 * 1000;
const JOURNAL_MAX_SESSIONS = 60;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
function workedMs(times) {
  let ms = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap > 0 && gap < JOURNAL_GAP_MS) ms += gap;
  }
  return ms;
}
async function journal(since = startOfToday()) {
  const rooms = () => ({ library: 0, dev: 0, server: 0, search: 0, meeting: 0, desk: 0 });
  const projects = new Map();
  for (const f of scanSessions().filter(x => x.mtime >= since).slice(0, JOURNAL_MAX_SESSIONS)) {
    const s = new Session(f.file, ALL_INITIAL_BYTES);
    let main = s.main.load(ALL_INITIAL_BYTES) || [];
    // 끝부분만 읽었는데 거기 들어 있는 일이 다 오늘 것이면, 오늘 일이 더 앞에서 시작했을 수 있다: 처음부터 흘려 읽는다
    if (s.main.skipped > 0 && (!main.length || main[0].ts >= since)) main = await readAllEvents(f.file, new Normalizer());
    main = main.filter(e => e.ts >= since);
    const subs = s.findAgents().map(({ evs }) => evs.filter(e => e.ts >= since)).filter(evs => evs.length);
    if (!main.length && !subs.length) continue;
    const meta = s.metaOut();
    const key = meta.cwd || f.dir;
    if (!projects.has(key)) {
      projects.set(key, { project: meta.project || baseName(key), cwd: meta.cwd || '', sessions: [], prompts: 0, tools: 0, errors: 0, interns: 0, workedMs: 0, first: Infinity, last: 0, rooms: rooms() });
    }
    const p = projects.get(key);
    const all = main.concat(...subs);
    for (const e of all) {
      if (e.k === 'tool') { p.tools++; p.rooms[e.room]++; }
      if (e.k === 'result' && !e.ok) p.errors++;
      p.first = Math.min(p.first, e.ts);
      p.last = Math.max(p.last, e.ts);
    }
    p.prompts += main.filter(e => e.k === 'user').length;
    p.interns += subs.length;
    const worked = workedMs(main.map(e => e.ts).sort((a, b) => a - b));
    p.workedMs += worked;
    p.sessions.push({ id: s.sid, file: f.file, title: describe(f).title, workedMs: worked, last: Math.max(...all.map(e => e.ts)) });
  }
  const list = [...projects.values()].sort((a, b) => b.workedMs - a.workedMs || b.last - a.last);
  for (const p of list) p.sessions.sort((a, b) => b.last - a.last);
  const sum = k => list.reduce((n, p) => n + p[k], 0);
  return {
    since,
    projects: list,
    totals: { projects: list.length, sessions: list.reduce((n, p) => n + p.sessions.length, 0), workedMs: sum('workedMs'), prompts: sum('prompts'), tools: sum('tools'), errors: sum('errors'), interns: sum('interns') },
  };
}

module.exports = { scanSessions, describe, insideProjects, waits, onHook, Follower, replayOf, journal, workedMs };
