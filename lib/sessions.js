// 세션 기록 파일을 찾고 따라 읽어서 화면(SSE)마다 보내는 부분:
// 세션 목록, 권한 확인 대기(hooks), 파일 따라 읽기(Tail·Session), 화면별 추적(Follower), 다시 보기.
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFile } = require('child_process');
const {
  PROJECTS, POLL_MS, HISTORY_EVENTS, MAX_INITIAL_BYTES, ALL_INITIAL_BYTES, SUB_INITIAL_BYTES, ACTIVE_MS, SUB_IDLE_MS, MAX_SESSIONS,
} = require('./config');
const { roomOf, ASK_TOOLS, contextWindow, clip, baseName, displayName, labelOf, detailOf, Normalizer, syntheticNote, limitUntilOf, rootCwd, worktreeOf } = require('./normalize');

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

// 기록 폴더 훑기. 세션이 수천 개면 파일마다 stat하는 게 꽤 비싸서(5000개에 14ms쯤) 2초마다 하기엔 아깝다.
// 그래서 훑는 데 걸린 시간에 맞춰 쉬었다가(오래 걸릴수록 길게, 최대 10초) 다시 전부 훑고,
// 그 사이에는 프로젝트 폴더의 시각만 본다: 새 세션 파일이 생기거나 지워지면 폴더 시각이 바뀐다.
// 세션이 몇십 개면 훑는 데 1ms도 안 걸려서 늘 새로 훑는다.
const scan = { list: null, at: 0, cost: 0, dirs: new Map() };

function projectDirs() {
  try { return fs.readdirSync(PROJECTS, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; }
}

function fullScan() {
  const t0 = Date.now();
  const out = [];
  scan.dirs = new Map();
  for (const name of projectDirs()) {
    const dir = path.join(PROJECTS, name);
    let files = [];
    try {
      scan.dirs.set(name, fs.statSync(dir).mtimeMs);
      files = fs.readdirSync(dir);
    } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const file = path.join(dir, f);
      try {
        const st = fs.statSync(file);
        out.push({ file, mtime: st.mtimeMs, born: st.birthtimeMs || 0, size: st.size, dir: name });
      } catch { /* 지워진 파일 */ }
    }
  }
  scan.list = out.sort((a, b) => b.mtime - a.mtime);
  scan.at = Date.now();
  scan.cost = scan.at - t0;
  return scan.list.slice();
}

// 지난번 이후 프로젝트 폴더가 생기거나 없어지거나, 안에서 파일이 생기거나 지워졌는지
function dirsChanged() {
  const names = projectDirs();
  if (names.length !== scan.dirs.size) return true;
  for (const name of names) {
    let m;
    try { m = fs.statSync(path.join(PROJECTS, name)).mtimeMs; } catch { return true; }
    if (scan.dirs.get(name) !== m) return true;
  }
  return false;
}

function scanSessions() {
  if (!scan.list) return fullScan();
  const rest = Math.min(10000, scan.cost * 500); // 14ms 걸렸으면 7초 쉰다, 1ms 안쪽이면 0.5초
  if (Date.now() - scan.at >= rest || dirsChanged()) return fullScan();
  return scan.list.slice();
}

const metaCache = new Map();
function describe(s) {
  const hit = metaCache.get(s.file);
  if (hit && hit.mtime === s.mtime) return hit;
  let title = '', aiTitle = '', prompt = '', cwd = '';
  // 마지막으로 한 일이 '사용 한도' 안내면 풀릴 때까지 빌딩에 남긴다 (limitUntil)
  let limitUntil = 0, decided = false;
  const st = { size: s.size };
  const tail = readRange(s.file, Math.max(0, st.size - 256 * 1024), st.size).toString('utf8').split('\n');
  for (let i = tail.length - 1; i >= 0 && !(title && cwd && decided); i--) {
    const l = tail[i];
    if (l.charCodeAt(0) !== 123) continue;
    let j;
    try { j = JSON.parse(l); } catch { continue; }
    if (!title && j.type === 'custom-title' && j.customTitle) title = j.customTitle;
    if (!title && j.type === 'summary' && j.summary) title = j.summary;
    if (!aiTitle && j.type === 'ai-title' && j.aiTitle) aiTitle = j.aiTitle;
    if (!prompt && j.type === 'last-prompt' && j.lastPrompt) prompt = j.lastPrompt;
    if (!cwd && j.cwd) cwd = j.cwd;
    if (!decided && !j.isMeta && !j.isSidechain && (j.type === 'assistant' || j.type === 'user')) {
      const m = j.message || {};
      const text = m.model === '<synthetic>' && Array.isArray(m.content) && (m.content.find(b => b && b.type === 'text') || {}).text;
      const note = text != null && text !== false ? syntheticNote(text, Date.parse(j.timestamp) || s.mtime) : undefined;
      if (note === null) continue; // 'No response requested.'처럼 보여 줄 것 없는 안내는 건너뛰고 더 앞을 본다
      decided = true;
      if (note && note.kind === 'limit') limitUntil = limitUntilOf({ ...note, ts: Date.parse(j.timestamp) || s.mtime });
    }
  }
  // 마지막 줄의 폴더가 하위 폴더여도 세션을 시작한 폴더로 (기록 폴더 이름과 맞는 위 폴더)
  const root = rootCwd([cwd], s.dir) || cwd;
  const d = {
    file: s.file,
    id: path.basename(s.file, '.jsonl'),
    mtime: s.mtime,
    size: s.size,
    title: clip(title || aiTitle || prompt || '(제목 없음)', 70),
    project: cwd ? baseName((worktreeOf(root) || { home: root }).home) : s.dir,
    cwd: root,
    limitUntil,
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

// 권한 대기를 남긴 Claude Code가 아직 살아 있는지 알아보려고 그 pid를 찾는다.
// hook은 Claude Code가 띄운 프로세스라 부모가 Claude Code다 (셸을 거쳐 띄웠으면 한두 단계 더 올라간다).
// Windows에서는 알아보지 않는다 (대신 하루가 지나면 지운다).
function claudePid(ppid, done, hops = 0) {
  const pid = Number(ppid);
  if (!Number.isInteger(pid) || pid <= 1 || process.platform === 'win32') return done(0);
  execFile('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], { timeout: 2000 }, (err, out) => {
    const m = !err && String(out).trim().match(/^(\d+)\s+(.+)$/);
    if (!m) return done(0);
    if (/^-?(sh|bash|zsh|dash|fish|ksh)$/.test(path.basename(m[2].trim())) && hops < 2) return claudePid(m[1], done, hops + 1);
    done(pid);
  });
}
const alive = pid => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } // EPERM: 있긴 한데 남의 프로세스
};
const WAIT_MAX_MS = 24 * 3600 * 1000;

// 대화 압축(compact)도 끝나야 기록에 남아서, 1~2분 걸리는 동안은 PreCompact hook이 알려 준 것을 들고 있다.
// 세션 id → { ts, trigger: 'auto'|'manual', pid }
const compacting = new Map();
const COMPACT_MAX_MS = 10 * 60 * 1000;

function onHook(h) {
  const sid = String(h.session_id || '');
  if (!sid) return;
  const agentId = h.agent_id ? String(h.agent_id) : '';
  let w = null;
  let c = null;
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
    case 'PreCompact':
      if (agentId) return; // 인턴의 압축은 따로 보여 주지 않는다
      c = { ts: Date.now(), trigger: h.trigger === 'manual' ? 'manual' : 'auto' };
      compacting.set(sid, c);
      break;
    case 'SessionEnd': {
      const had = waits.delete(sid);
      if (!compacting.delete(sid) && !had) return;
      break;
    }
    default:
      return;
  }
  if (w) {
    waits.set(sid, w);
    if (h.ppid) claudePid(h.ppid, pid => { if (pid && waits.get(sid) === w) w.pid = pid; });
  }
  if (c && h.ppid) claudePid(h.ppid, pid => { if (pid && compacting.get(sid) === c) c.pid = pid; });
  let file = null;
  if (w || c) for (const f of followers) if (f.mode !== 'file' && !f.sessions.has(sid)) { file = findSession(sid); break; }
  for (const f of followers) f.hook(sid, file);
}

function findSession(sid) {
  const s = scanSessions().find(x => path.basename(x.file, '.jsonl') === sid);
  return s ? s.file : null;
}

// 빌딩에 보일 세션: 최근 30분 안에 움직였거나 권한을 기다리는 세션 (하나도 없으면 가장 최근 하나)
// 사용 한도가 풀리기를 기다리는 세션 (반나절 안에 움직인 것만 본다)
const limited = s => Date.now() - s.mtime < 12 * 3600 * 1000 && describe(s).limitUntil > Date.now();

function activeFiles() {
  const all = scanSessions();
  const pick = all.filter(s => Date.now() - s.mtime < ACTIVE_MS || waits.has(path.basename(s.file, '.jsonl')) || limited(s)).slice(0, MAX_SESSIONS);
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

// 인턴이 지금까지 한 일: 화면에는 마지막 40개만 보내니까, 시작한 때와 그 앞에서 쓴 도구 수를 따로 알려 준다
function internSoFar(evs) {
  const before = evs.slice(0, -40).filter(e => e.k === 'tool').length;
  return { startTs: evs.length ? evs[0].ts : 0, toolsBefore: before };
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
      agents.push({ ...a.info, ...internSoFar(evs), history: evs.slice(-40).map(e => ({ ...e, agent: a.info.id })) });
    }
    const wait = this.checkWait(events, subEvents);
    const compact = this.checkCompact(events);
    this.waitKey = waitKey(wait) + (compact ? `#${compact.ts}` : '');
    const st = { file: this.file, mtime: this.main.mtime, size: this.main.size, dir: baseName(path.dirname(this.file)) };
    return {
      sid: this.sid,
      session: { ...describe(st), ...this.metaOut() },
      history: events.slice(-HISTORY_EVENTS),
      plan: this.main.norm.plan,
      stats: this.stats(),
      wait,
      compacting: compact,
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
        events.push({ k: 'agent', ts: Date.now(), agent: a.info.id, type: a.info.type, desc: a.info.desc, parent: a.info.parent, ...internSoFar(evs) });
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
    const compact = this.checkCompact(main);
    const key = waitKey(wait) + (compact ? `#${compact.ts}` : '');
    if (!events.length && !force && key === this.waitKey && !this.statsDirty) return null;
    this.waitKey = key;
    this.statsDirty = false;
    return { sid: this.sid, events, plan: this.main.norm.plan, stats: this.stats(), meta: this.metaOut(), wait, compacting: compact };
  }

  // 대화 압축 중인지. 압축이 기록에 남았거나(hook보다 먼저 남을 수도 있어서 몇 초 앞까지 본다),
  // 그 뒤로 다른 일이 기록됐거나, Claude Code가 꺼졌으면 끝난 걸로 본다. 그사이 끼어든 내 메시지·알림은 빼고 본다.
  checkCompact(mainEvents) {
    const c = compacting.get(this.sid);
    if (!c) return null;
    const moved = mainEvents.some(e => e.ts >= c.ts && e.k !== 'note' && !(e.k === 'user' && e.queued));
    if (moved || this.main.norm.compactAt >= c.ts - 5000 || (c.pid && !alive(c.pid)) || Date.now() - c.ts > COMPACT_MAX_MS) {
      compacting.delete(this.sid);
      return null;
    }
    return { ts: c.ts, trigger: c.trigger };
  }

  // 이 세션의 권한 대기. 기다리는 도구를 기록에서 찾아 id를 붙이고, 이미 끝난 대기는 지운다.
  checkWait(mainEvents, subEvents) {
    const w = waits.get(this.sid);
    if (!w) return null;
    // 권한 창을 띄운 채 Claude Code가 꺼졌으면(강제 종료·터미널 닫힘 등 SessionEnd 없이) 더는 기다리지 않는다.
    // pid를 모르면 하루가 지난 대기를 지운다.
    if ((w.pid && !alive(w.pid)) || Date.now() - w.ts > WAIT_MAX_MS) {
      waits.delete(this.sid);
      return null;
    }
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
    if (m.title || m.aiTitle) out.title = clip(m.title || m.aiTitle, 70);
    if (m.pr) out.pr = m.pr;
    if (m.cost) out.cost = m.cost;
    if (m.mode) out.mode = m.mode;
    // cwd는 세션을 시작한 폴더(층·프로젝트 이름·이어 하기 기준), here는 지금 있는 하위 폴더
    const root = rootCwd([...this.main.norm.cwds, m.cwd], path.basename(path.dirname(this.file))) || m.cwd;
    // home은 층·프로젝트 이름의 기준 (워크트리에서 시작했으면 원래 프로젝트 폴더)
    if (root) {
      const wt = worktreeOf(root);
      out.cwd = root;
      out.home = wt ? wt.home : root;
      out.project = baseName(out.home);
      if (wt) out.worktree = wt.name;
    }
    if (m.cwd && root && m.cwd !== root) out.here = m.cwd;
    const ctx = this.main.norm.ctx;
    if (ctx) out.ctx = { tokens: ctx, window: contextWindow(m.model, ctx) };
    out.queue = this.main.norm.queue.slice(0, 5); // 비었을 때도 보내야 화면이 지운다
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
      // 오래 조용한 직원은 퇴근한다. 권한을 기다리는 직원, 사용 한도가 풀리기를 기다리는 직원,
      // 그리고 빌딩이 텅 비지 않게 마지막 한 명은 남긴다.
      const quiet = [...this.sessions.values()]
        .filter(s => !waits.has(s.sid) && !(s.main.norm.limitUntil > Date.now()) && Date.now() - s.lastActive() > ACTIVE_MS)
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
// 그날(0시~다음 날 0시) 움직인 세션을 프로젝트별로 모아서 정리한다.
// 일한 시간은 기록 사이 간격이 5분보다 짧은 것만 더한다 (그보다 길면 쉬었다고 본다).
const JOURNAL_GAP_MS = 5 * 60 * 1000;
const JOURNAL_MAX_SESSIONS = 60;
// day: 0 = 오늘, -1 = 어제, … 또는 'YYYY-MM-DD'. 내 컴퓨터 시간대의 하루.
function dayRange(day = 0) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day));
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
  if (!m) d.setDate(d.getDate() + (Math.trunc(Number(day)) || 0));
  d.setHours(0, 0, 0, 0);
  const since = d.getTime();
  d.setDate(d.getDate() + 1); // 서머타임이 있어도 다음 날 0시
  return { since, until: d.getTime() };
}
function workedMs(times) {
  let ms = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap > 0 && gap < JOURNAL_GAP_MS) ms += gap;
  }
  return ms;
}
async function journal(day = 0) {
  const { since, until } = dayRange(day);
  const rooms = () => ({ library: 0, dev: 0, server: 0, search: 0, meeting: 0, desk: 0 });
  const projects = new Map();
  const hours = Array(24).fill(0); // 시간대별 도구 사용 (0시~23시, 내 컴퓨터 시간)
  const inDay = e => e.ts >= since && e.ts < until;
  // 그날 이후에 고쳐졌고, 그날이 끝나기 전에 만들어진 기록 (만든 시각을 모르는 시스템이면 born이 0)
  const files = scanSessions().filter(x => x.mtime >= since && !(x.born > until));
  for (const f of files.slice(0, JOURNAL_MAX_SESSIONS)) {
    const s = new Session(f.file, ALL_INITIAL_BYTES);
    let main = s.main.load(ALL_INITIAL_BYTES) || [];
    // 끝부분만 읽었는데 거기 들어 있는 일이 다 오늘 것이면, 오늘 일이 더 앞에서 시작했을 수 있다: 처음부터 흘려 읽는다
    if (s.main.skipped > 0 && (!main.length || main[0].ts >= since)) main = await readAllEvents(f.file, new Normalizer());
    main = main.filter(inDay);
    const subs = s.findAgents().map(({ evs }) => evs.filter(inDay)).filter(evs => evs.length);
    if (!main.length && !subs.length) continue;
    const meta = s.metaOut();
    const key = meta.home || meta.cwd || f.dir;
    if (!projects.has(key)) {
      projects.set(key, { project: meta.project || baseName(key), cwd: meta.home || meta.cwd || '', sessions: [], prompts: 0, tools: 0, errors: 0, interns: 0, tokens: 0, workedMs: 0, first: Infinity, last: 0, rooms: rooms() });
    }
    const p = projects.get(key);
    const all = main.concat(...subs);
    // 마지막 시각은 하나씩 견주어 구한다: Math.max(...아주 긴 배열)은 이벤트가 12만 개쯤 넘으면 터진다
    let last = 0;
    for (const e of all) {
      if (e.k === 'tool') { p.tools++; p.rooms[e.room]++; hours[new Date(e.ts).getHours()]++; }
      if (e.k === 'result' && !e.ok) p.errors++;
      if (e.tok) p.tokens += e.tok; // Claude와 인턴이 만든 출력 토큰
      if (e.ts > last) last = e.ts;
      p.first = Math.min(p.first, e.ts);
    }
    p.last = Math.max(p.last, last);
    p.prompts += main.filter(e => e.k === 'user').length;
    p.interns += subs.length;
    // 일한 시간은 인턴 기록까지 합쳐서 본다: 인턴이 오래 일하는 동안 메인 기록은 조용해서, 메인만 보면 쉰 걸로 셌다
    const worked = workedMs(all.map(e => e.ts).sort((a, b) => a - b));
    p.workedMs += worked;
    p.sessions.push({ id: s.sid, file: f.file, title: describe(f).title, workedMs: worked, last });
  }
  const list = [...projects.values()].sort((a, b) => b.workedMs - a.workedMs || b.last - a.last);
  for (const p of list) p.sessions.sort((a, b) => b.last - a.last);
  const sum = k => list.reduce((n, p) => n + p[k], 0);
  return {
    since,
    until,
    today: since === dayRange(0).since,
    projects: list,
    hours,
    totals: { projects: list.length, sessions: list.reduce((n, p) => n + p.sessions.length, 0), workedMs: sum('workedMs'), prompts: sum('prompts'), tools: sum('tools'), errors: sum('errors'), interns: sum('interns'), tokens: sum('tokens') },
  };
}

module.exports = { scanSessions, describe, insideProjects, waits, onHook, Follower, replayOf, journal, workedMs, dayRange };
