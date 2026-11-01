// Claude 사무실 — 서버가 보내는 세션 이벤트를 받아 층마다 직원(세션)과 인턴(서브에이전트)을 움직인다.
import { $, esc, clip, hhmmss, stamp, ago } from './js/util.js';
import { W, H, ROOMS, ROOM_IDS, buildFloor } from './js/scene.js';
import { Actor } from './js/actor.js';
import { DEMO_SESSIONS, DEMO_SCRIPT } from './js/demo.js';
import { createFeed } from './js/feed.js';
import { createAlerts } from './js/alerts.js';
import { createJournal } from './js/journal.js';
import { createReplay } from './js/replay.js';

const COLORS = ['#D97757', '#4C8BF5', '#2FA36B', '#9B6CE8', '#E0607E', '#D49A1F', '#1FA3A3', '#7C8799'];
const STATUS_ORDER = { wait: 0, ask: 1 };
const emptyStats = () => ({ library: 0, dev: 0, server: 0, search: 0, meeting: 0, desk: 0, tools: 0, errors: 0, prompts: 0 });
const shortName = info => clip(info.title || info.project || '세션', 18);
// 548123 → '54.8만'
const fmtTokens = n => (n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')}만` : n.toLocaleString());
// 컨텍스트가 얼마나 찼는지: 비율과 색 단계
function ctxOf(s) {
  const c = s && s.info.ctx;
  if (!c || !c.tokens) return null;
  const p = Math.min(100, Math.round((c.tokens / c.window) * 100));
  return { p, level: p >= 85 ? 'high' : p >= 60 ? 'mid' : 'low', text: `${fmtTokens(c.tokens)} / ${fmtTokens(c.window)} 토큰` };
}

// ───────────────────────── 상태 ─────────────────────────
const sessions = new Map(); // 세션 id → { sid, info, floor, color, main, interns, plan, planAt, stats, wait }
const floors = new Map(); // 층 key(작업 폴더) → { key, name, sids }
const actors = new Set();
const colorOf = new Map(); // 세션 id → 색 (다시 붙어도 같은 색)
const seenWaits = new Set();
let current = null; // 보고 있는 층
let floorAuto = true;
let viewMode = 'all'; // all 빌딩 · auto 가장 최근 세션 · file 고른 세션 · demo
let es = null, demo = null;
let boardSid = null, boardPlan = null;

// 캐릭터들이 같이 쓰는 것: 자리 배정, 화이트보드, '나'의 말풍선, 퇴근 처리
const office = {
  actorsEl: $('actors'),
  // 방에 들어갈 때 같은 층의 다른 사람과 겹치지 않는 자리를 고른다
  claim(actor, room) {
    const used = new Set();
    for (const a of actors) if (a !== actor && a.floor === actor.floor && a.slotRoom === room && !a.leaving) used.add(a.slot);
    let i = 0;
    while (used.has(i)) i++;
    actor.slotRoom = room;
    actor.slot = i;
    return i;
  },
  plan(actor, plan, animate) {
    const s = sessions.get(actor.sid);
    if (!s) return 0;
    s.plan = plan;
    s.planAt = Date.now();
    if (s.floor !== current) return 0;
    boardSid = s.sid;
    return setBoard(plan, animate);
  },
  userSay(actor, text) {
    if (actor.floor === current) userSay(text);
  },
  // 같은 세션(메인과 인턴들)에서 가장 최근에 기록이 남은 시각
  activityOf(actor) {
    const s = sessions.get(actor.sid);
    if (!s) return 0;
    return Math.max(s.main.lastEventTs, ...[...s.interns.values()].map(a => a.lastEventTs));
  },
  select(actor) {
    openCard(actor);
  },
  remove(actor) {
    if (cardActor === actor) closeCard();
    actors.delete(actor);
    const s = sessions.get(actor.sid);
    if (s && s.interns.get(actor.agent) === actor) s.interns.delete(actor.agent);
    actor.destroy();
  },
};

// ───────────────────────── 화면 뼈대 ─────────────────────────
const el = { stage: $('stage'), box: $('stageBox'), wrap: $('stageWrap'), feed: $('feed'), board: $('board') };
const signs = {}, statRows = {};
const feed = createFeed(el.feed, { manyPeople: () => sessions.size > 1 });
const alerts = createAlerts({ toast: (...a) => toast(...a), goFloor: key => goFloor(key), quiet: () => viewMode === 'demo' || viewMode === 'replay' });
const journal = createJournal({ toast: (...a) => toast(...a), onPick: file => replay.start(file) });
const replay = createReplay({
  pickFile: () => {
    const focus = focusActor([...actors].filter(a => a.floor === current));
    return isFile(sel.value) ? sel.value : focus && sessions.get(focus.sid) && sessions.get(focus.sid).info.file;
  },
  beforeStart: () => {
    stopDemo(false);
    if (es) { es.close(); es = null; }
    floorAuto = true;
  },
  hello: d => onHello(d),
  update: u => applyUpdate(u),
  busy: sid => Math.max(0, ...[...actors].filter(a => a.sid === sid).map(a => a.queue.length + (a.running ? 1 : 0))),
  setConn: (state, text) => setConn(state, text),
  toast: text => toast(text),
  emptyStats,
  countLocal: (s, ev) => countLocal(s, ev),
  reconnect: () => connect(),
});

function buildChrome() {
  for (const id of ROOM_IDS) {
    const r = ROOMS[id];
    const d = document.createElement('div');
    d.className = 'door-sign';
    d.dataset.room = id;
    d.style.setProperty('--c', `var(--${id})`);
    d.style.top = (r.row === 'top' ? 354 : 406) + 'px';
    d.style.left = (r.signRight ? r.door + 46 : r.door - 46) + 'px';
    if (r.signRight) d.style.transform = 'none';
    d.innerHTML = `<i class="dot"></i>${r.icon} ${r.name} <small>${r.sub}</small> <b>0</b>`;
    $('signs').appendChild(d);
    signs[id] = d;

    const row = document.createElement('div');
    row.className = 'rs';
    row.style.setProperty('--c', `var(--${id})`);
    row.innerHTML = `<span>${r.icon} ${r.name}</span><div class="bar"><i></i></div><b>0</b>`;
    $('roomStats').appendChild(row);
    statRows[id] = row;
  }
}

function fit() {
  const pad = 36;
  const narrow = matchMedia('(max-width: 1100px)').matches;
  const byWidth = (el.wrap.clientWidth - pad) / W;
  const s = narrow ? byWidth : Math.min(byWidth, (el.wrap.clientHeight - pad) / H, 1.6);
  const scale = Math.max(0.3, s);
  el.stage.style.transform = `scale(${scale})`;
  el.box.style.width = W * scale + 'px';
  el.box.style.height = H * scale + 'px';
}

let userTimer = 0;
function userSay(text) {
  const b = $('userBubble');
  b.innerHTML = `<span class="who">나</span>${esc(clip(text, 90))}`;
  b.style.left = '0px';
  const w = b.offsetWidth;
  const left = Math.max(1048, Math.min(1146 - w / 2, 1240 - w));
  b.style.left = left + 'px';
  b.style.top = '652px';
  b.style.setProperty('--tail-x', Math.max(16, Math.min(1146 - left, w - 16)) + 'px');
  b.classList.add('show');
  clearTimeout(userTimer);
  userTimer = setTimeout(() => b.classList.remove('show'), 6000);
}

// ───────────────────────── 화이트보드 ─────────────────────────
function setBoard(plan, animate) {
  const prev = boardPlan;
  boardPlan = plan || null;
  const all = (plan && plan.items) || [];
  let items = all;
  if (all.length > 14) {
    const cur = Math.max(0, all.findIndex(i => i.status !== 'done'));
    const start = Math.max(0, Math.min(cur - 3, all.length - 14));
    items = all.slice(start, start + 14);
  }
  el.board.classList.toggle('has-items', all.length > 0);
  el.board.dataset.size = items.length > 6 ? 'xs' : items.length > 5 ? 's' : 'm';
  $('boardTitle').textContent = plan ? plan.title || '계획' : '화이트보드';
  const done = all.filter(i => i.status === 'done').length;
  $('boardCount').textContent = all.length ? `${done}/${all.length}` : '';
  const before = new Set(((prev && prev.items) || []).map(i => i.status + '|' + i.text));
  const list = $('boardList');
  list.innerHTML = '';
  let fresh = 0;
  for (const it of items) {
    const li = document.createElement('li');
    li.className = it.status;
    li.innerHTML = `<i>${it.status === 'done' ? '✔' : it.status === 'doing' ? '▶' : '☐'}</i><span>${esc(it.text)}</span>`;
    if (animate && !before.has(it.status + '|' + it.text)) {
      li.classList.add('fresh');
      li.style.animationDelay = (fresh++ * 0.18) + 's';
    }
    list.appendChild(li);
  }
  return fresh;
}

// 층을 옮기면 그 층에서 가장 최근에 계획을 쓴 세션의 화이트보드를 보여 준다
function refreshBoard() {
  let best = null;
  for (const s of sessions.values()) {
    if (s.floor !== current || !s.plan) continue;
    if (!best || s.planAt > best.planAt || (s.planAt === best.planAt && s.main.lastEventTs > best.main.lastEventTs)) best = s;
  }
  boardSid = best ? best.sid : null;
  if ((best ? best.plan : null) !== boardPlan) setBoard(best ? best.plan : null, false);
}

// ───────────────────────── 세션·인턴 ─────────────────────────
function addSession(snap) {
  removeSession(snap.sid);
  const info = { ...(snap.session || {}) };
  const key = info.cwd || info.project || snap.sid;
  if (!floors.has(key)) floors.set(key, { key, name: info.project || clip(key, 20), sids: new Set() });
  floors.get(key).sids.add(snap.sid);
  if (!colorOf.has(snap.sid)) colorOf.set(snap.sid, COLORS[colorOf.size % COLORS.length]);
  const s = {
    sid: snap.sid, info, floor: key, color: colorOf.get(snap.sid), interns: new Map(),
    plan: snap.plan || null, planAt: snap.plan ? 1 : 0, stats: snap.stats || emptyStats(), wait: snap.wait || null,
  };
  sessions.set(s.sid, s);
  const w = s.wait;
  const internIds = new Set((snap.agents || []).map(a => a.id));
  s.main = new Actor(office, { key: s.sid, sid: s.sid, name: shortName(info), color: s.color, floor: key });
  actors.add(s.main);
  s.main.load(snap.history || [], w && !(w.on && internIds.has(w.on)) ? w : null);
  for (const a of snap.agents || []) addIntern(s, a).load(a.history || [], w && w.on === a.id ? w : null);
  if (w) seenWaits.add(waitId(s.sid, w));
  return s;
}

function addIntern(s, a) {
  const it = new Actor(office, { key: `${s.sid}:${a.id}`, sid: s.sid, agent: a.id, intern: true, name: a.type || '인턴', color: s.color, floor: s.floor });
  it.desc = a.desc || '';
  s.interns.set(a.id, it);
  actors.add(it);
  return it;
}

function removeSession(sid) {
  const s = sessions.get(sid);
  if (!s) return;
  for (const a of [s.main, ...s.interns.values()]) {
    actors.delete(a);
    a.destroy();
  }
  sessions.delete(sid);
  const f = floors.get(s.floor);
  if (f) {
    f.sids.delete(sid);
    if (!f.sids.size) floors.delete(s.floor);
  }
  if (boardSid === sid) boardSid = null;
  if (current === s.floor && !floors.has(current)) current = null;
}

// 오래 조용한 세션의 직원(과 인턴)이 퇴근한다: 보이는 층이면 걸어 나가고, 아니면 바로 정리한다
function retireSession(sid) {
  const s = sessions.get(sid);
  if (!s) return;
  feed.add(s, s.main, { k: 'leave', ts: Date.now() });
  if (s.floor !== current) {
    removeSession(sid);
    render();
    return;
  }
  for (const a of [s.main, ...s.interns.values()]) a.walkOut();
  setTimeout(() => {
    if (sessions.get(sid) !== s) return; // 그 사이 다시 출근했다
    removeSession(sid);
    render();
  }, 8000);
}

function applyUpdate(u) {
  const s = sessions.get(u.sid);
  if (!s) return;
  if (u.meta) {
    Object.assign(s.info, u.meta);
    s.main.name = shortName(s.info);
  }
  if (u.stats) s.stats = u.stats;
  const batches = new Map();
  for (const ev of u.events || []) {
    let a = s.main;
    if (ev.agent) {
      a = s.interns.get(ev.agent);
      if (!a || a.leaving) {
        // 새 인턴은 복도에서 걸어 들어온다
        a = addIntern(s, { id: ev.agent, type: ev.k === 'agent' ? ev.type : '', desc: ev.desc });
        a.appearInHall(ROOMS.meeting.door);
      }
    }
    if (!u.stats) countLocal(s, ev);
    feed.add(s, a, ev);
    if (ev.k === 'tool' && ev.ask) alerts.notify(s, '❓ 물어볼 게 있어요', ev.ask);
    if (ev.k === 'say' && ev.final && !ev.agent) alerts.notify(s, '✅ 응답 완료', ev.text);
    if (!batches.has(a)) batches.set(a, []);
    batches.get(a).push(ev);
  }
  for (const [a, evs] of batches) a.ingest(evs);
  if ('wait' in u) setWait(s, u.wait);
}

const waitId = (sid, w) => `${sid}|${w.ts}`;
// 권한 대기는 기다리는 캐릭터(인턴이면 그 인턴)에게 준다. 새 대기면 그 층으로 엘리베이터를 탄다.
function setWait(s, w) {
  s.wait = w || null;
  const target = w ? (w.on && s.interns.get(w.on)) || s.main : null;
  for (const a of [s.main, ...s.interns.values()]) {
    const mine = a === target ? w : null;
    if ((a.waitState && a.waitState.ts) !== (mine && mine.ts)) a.setWait(mine);
  }
  if (w && !seenWaits.has(waitId(s.sid, w))) {
    seenWaits.add(waitId(s.sid, w));
    feed.add(s, target, { ...w, k: 'wait' });
    alerts.notifyWait(s, w);
    if (floorAuto && s.floor !== current) goFloor(s.floor);
  }
}

function countLocal(s, ev) {
  if (ev.k === 'tool') { s.stats[ev.room]++; s.stats.tools++; }
  if (ev.k === 'result' && !ev.ok) s.stats.errors++;
  if (ev.k === 'user' && !ev.agent) s.stats.prompts++;
}

// ───────────────────────── 층 ─────────────────────────
const floorNum = key => [...floors.keys()].indexOf(key) + 1;

function goFloor(key, pin) {
  if (pin) floorAuto = false;
  if (!floors.has(key)) return;
  if (key !== current) {
    current = key;
    toast(`🛗 ${floorNum(key)}F · ${floors.get(key).name}`);
    el.stage.classList.remove('arrive');
    void el.stage.offsetWidth;
    el.stage.classList.add('arrive');
    $('userBubble').classList.remove('show');
    refreshBoard();
  }
  render();
}

// 처음 볼 층: 나를 기다리는 직원이 있는 층, 없으면 가장 최근에 일한 층
function busiestFloor() {
  let best = null;
  for (const a of actors) {
    if (!best || (!!a.waitState > !!best.waitState) || (!!a.waitState === !!best.waitState && a.lastEventTs > best.lastEventTs)) best = a;
  }
  return best ? best.floor : [...floors.keys()][0] || null;
}

// 자동: 지금 층이 15초 넘게 조용하고 다른 층에서 방금 일이 생겼으면 그리로 간다
function autoFloor() {
  if (!current || !floors.has(current)) {
    current = busiestFloor();
    refreshBoard();
    return;
  }
  if (!floorAuto || floors.size < 2) return;
  const here = [...actors].filter(a => a.floor === current);
  const needsMe = a => a.waitState || a.status === 'ask';
  if (here.some(needsMe)) return;
  // 다른 층에서 누가 나를 기다리면 바로 그리로
  const waiting = [...actors].find(a => a.floor !== current && needsMe(a));
  if (waiting) return goFloor(waiting.floor);
  if (Date.now() - Math.max(0, ...here.map(a => a.lastActivity)) < 15000) return;
  let best = null;
  for (const a of actors) if (a.floor !== current && Date.now() - a.lastActivity < 4000 && (!best || a.lastActivity > best.lastActivity)) best = a;
  if (best) goFloor(best.floor);
}

let toastTimer = 0;
function toast(text) {
  const t = $('floorToast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1400);
}

// 오래 소식이 없는 인턴은 퇴근시킨다 (끝났다는 기록을 못 봤을 때)
function retireInterns() {
  for (const a of actors) {
    if (a.intern && !a.leaving && !a.running && !a.path.length && !a.pending.size && !a.waitState && Date.now() - a.lastActivity > 180000) a.walkOut();
  }
}

// ───────────────────────── 그리기 ─────────────────────────
function focusActor(list) {
  if (!list.length) return null;
  return list.find(a => a.waitState) || list.find(a => a.status === 'ask') || list.reduce((b, a) => (a.lastActivity > b.lastActivity ? a : b));
}

let hlKey = '';
function highlight(rooms) {
  const key = [...rooms].sort().join();
  if (key === hlKey) return;
  hlKey = key;
  document.querySelectorAll('.room').forEach(g => g.classList.toggle('active', rooms.has(g.dataset.room)));
  for (const id of ROOM_IDS) {
    signs[id].classList.toggle('active', rooms.has(id));
    statRows[id].classList.toggle('active', rooms.has(id));
  }
}

let nowKey = '', titleKey = '';
function renderNow(a, many) {
  const st = a ? a.now : { icon: '⏳', title: sessions.size ? '이 층은 비어 있어요' : '따라갈 세션이 없어요', sub: '', room: 'desk', mode: '', time: '' };
  const sub = a && many ? `${a.intern ? '인턴 ' : ''}${a.name}${st.sub ? ' · ' + st.sub : ''}` : st.sub;
  // 지금 보는 직원의 컨텍스트 (인턴은 따로 세지 않는다)
  const ctx = a && !a.intern ? ctxOf(sessions.get(a.sid)) : null;
  const key = [st.icon, st.title, sub, st.room, st.mode, st.time, ctx ? ctx.p : ''].join('|');
  if (key !== nowKey) {
    const box = $('nowCtx');
    box.hidden = !ctx;
    if (ctx) {
      box.className = 'now-ctx ' + ctx.level;
      box.style.setProperty('--p', ctx.p + '%');
      box.querySelector('b').textContent = `컨텍스트 ${ctx.p}%`;
      box.title = `${ctx.text} 사용 중 · 꽉 차면 Claude Code가 앞부분을 요약해요`;
    }
    nowKey = key;
    $('nowIcon').textContent = st.icon;
    $('nowTitle').textContent = st.title;
    $('nowSub').textContent = sub || '';
    $('nowTime').textContent = st.time || '';
    $('now').dataset.room = st.room || '';
    $('now').dataset.mode = st.mode || '';
  }
  // 탭 제목: 다른 층에서라도 나를 기다리는 직원이 있으면 그걸 먼저 알린다
  const waiting = [...actors].filter(x => x.waitState || x.status === 'ask').length;
  const title = waiting ? `🔐 ${waiting}명이 기다려요 · Claude 사무실` : `${st.icon} ${st.title} · Claude 사무실`;
  if (title !== titleKey) document.title = titleKey = title;
  alerts.setFavicon(waiting);
}

let floorbarHtml = '';
function renderFloorbar() {
  const bar = $('floorbar');
  bar.hidden = floors.size < 2;
  if (bar.hidden) return;
  $('floorAuto').classList.toggle('on', floorAuto);
  const html = [...floors.values()].map((f, i) => {
    const on = [...actors].filter(a => a.floor === f.key && !a.leaving);
    const wait = on.some(a => a.waitState || a.status === 'ask');
    const busy = on.some(a => a.status === 'work' || a.status === 'think');
    return `<button type="button" class="fl${f.key === current ? ' active' : ''}${wait ? ' wait' : ''}${busy ? ' busy' : ''}" data-floor="${esc(f.key)}">`
      + `<b>${i + 1}F</b>${esc(f.name)}<small>${on.length}명</small>${wait ? '<i>🔐</i>' : ''}</button>`;
  }).join('');
  if (html !== floorbarHtml) $('floorTabs').innerHTML = floorbarHtml = html;
}

const ctxBar = c => (c ? `<i class="ctx ${c.level}" style="--p:${c.p}%" title="컨텍스트 ${c.p}% · ${esc(c.text)}"></i>` : '');
let lobbyHtml = '';
function renderLobby() {
  const rows = [];
  [...floors.values()].forEach((f, i) => {
    for (const sid of f.sids) {
      const s = sessions.get(sid);
      if (!s) continue;
      for (const a of [s.main, ...s.interns.values()]) {
        if (a.leaving) continue;
        const st = a.status;
        rows.push({
          rank: STATUS_ORDER[st] ?? 2, floor: i,
          html: `<li class="lb ${st}${a.floor === current ? ' here' : ''}${a.intern ? ' intern' : ''}" data-floor="${esc(f.key)}" data-actor="${esc(a.key)}" style="--wc:${s.color}">`
            + `<b>${i + 1}F</b><span class="nm">${a.intern ? '<em>인턴</em>' : ''}${esc(a.name)}</span>`
            + `<span class="st">${esc(a.now.icon)} ${esc(clip(a.now.title, 24))}</span><time>${esc(a.now.time || '')}</time>`
            + ctxBar(a.intern ? null : ctxOf(s)) + '</li>',
        });
      }
    }
  });
  // 나를 기다리는 직원이 맨 위, 나머지는 층 순서대로
  rows.sort((x, y) => x.rank - y.rank || x.floor - y.floor);
  const html = rows.map(r => r.html).join('') || '<li class="lb none">아직 아무도 출근하지 않았어요</li>';
  if (html !== lobbyHtml) $('lobby').innerHTML = lobbyHtml = html;
  const interns = [...actors].filter(a => a.intern && !a.leaving).length;
  $('lobbyCount').textContent = sessions.size ? `직원 ${sessions.size}명${interns ? ` · 인턴 ${interns}명` : ''}` : '';
}

function renderStats() {
  const t = emptyStats();
  for (const s of sessions.values()) if (s.floor === current) for (const k in t) t[k] += s.stats[k] || 0;
  const max = Math.max(1, ...ROOM_IDS.map(r => t[r]));
  for (const id of ROOM_IDS) {
    statRows[id].querySelector('i').style.width = (t[id] / max) * 100 + '%';
    statRows[id].querySelector('b').textContent = t[id];
    signs[id].querySelector('b').textContent = t[id];
  }
  $('kTools').textContent = t.tools;
  $('kErrors').textContent = t.errors;
  $('kPrompts').textContent = t.prompts;
  $('statsScope').textContent = floors.size > 1 && current ? `${floorNum(current)}F` : '';
}

let headerKey = '';
function renderHeader(focus) {
  let project = '—', title = '따라갈 세션이 없어요', meta = '';
  if (sessions.size) {
    const s = sessions.get(focus ? focus.sid : '') || [...sessions.values()].find(x => x.floor === current) || [...sessions.values()][0];
    const info = s.info;
    const where = [(info.model || '').replace(/^claude-/, ''), info.branch && info.branch !== 'HEAD' ? '⎇ ' + info.branch : ''];
    if (viewMode === 'all' || viewMode === 'demo') {
      const interns = [...actors].filter(a => a.intern && !a.leaving).length;
      project = viewMode === 'demo' ? '🏢 데모 빌딩' : '🏢 빌딩';
      title = `${floors.size}개 층 · 직원 ${sessions.size}명${interns ? ` · 인턴 ${interns}명` : ''}`;
      meta = [clip(info.project || '', 20), ...where].filter(Boolean).join(' · ');
    } else {
      project = info.project || '—';
      title = info.title || '(제목 없음)';
      meta = [...where, viewMode === 'auto' ? '자동 추적' : viewMode === 'replay' ? '⏪ 다시 보기' : ''].filter(Boolean).join(' · ');
    }
  }
  const key = project + '|' + title + '|' + meta;
  if (key === headerKey) return;
  headerKey = key;
  $('sessProject').textContent = project;
  $('sessTitle').textContent = title;
  $('sessMeta').textContent = meta;
}

function render() {
  const here = [...actors].filter(a => a.floor === current);
  for (const a of actors) a.wrap.hidden = a.floor !== current;
  // 이름표: 인턴은 늘, 직원은 같은 층에 둘 이상일 때
  const mains = here.filter(a => !a.intern).length;
  for (const a of here) a.setTag(a.intern ? a.name : mains > 1 ? a.name : '');
  highlight(new Set(here.filter(a => !a.leaving && a.hl).map(a => a.hl)));
  const focus = focusActor(here.filter(a => !a.leaving));
  renderNow(focus, here.length > 1);
  renderFloorbar();
  renderLobby();
  renderStats();
  renderHeader(focus);
  renderCard();
  $('empty').hidden = sessions.size > 0 || viewMode === 'demo';
}

// ───────────────────────── 캐릭터 정보 카드 ─────────────────────────
// 캐릭터를 누르면 옆에 뜬다: 지금 하는 일, 컨텍스트, 도구 수, 다시 보기·이 세션만 보기 버튼
let cardActor = null, cardHtml = '';
// keep: 이미 열려 있어도 닫지 않는다 (로비·활동 기록에서 열 때)
function openCard(a, keep) {
  cardActor = cardActor === a && !keep ? null : a; // 같은 캐릭터를 다시 누르면 닫는다
  cardHtml = '';
  renderCard();
}
function closeCard() {
  cardActor = null;
  $('card').hidden = true;
}
function renderCard() {
  const a = cardActor;
  const s = a && sessions.get(a.sid);
  if (!a || !s || a.leaving || a.floor !== current) return closeCard();
  const info = s.info;
  const ctx = !a.intern && ctxOf(s);
  const where = [info.project, (info.model || '').replace(/^claude-/, ''), info.branch && info.branch !== 'HEAD' ? '⎇ ' + info.branch : ''].filter(Boolean).map(esc).join(' · ');
  const head = a.intern
    ? `<b><em>인턴</em> ${esc(a.name)}</b><small>${esc(a.desc || '')}${a.desc ? ' · ' : ''}${esc(s.main.name)}의 인턴</small>`
    : `<b>${esc(info.title || s.main.name)}</b><small>${where}</small>`;
  const nums = a.intern ? '' : `<div class="card-nums">도구 ${s.stats.tools} · 실패 ${s.stats.errors} · 내 메시지 ${s.stats.prompts}${s.interns.size ? ` · 인턴 ${s.interns.size}명` : ''}</div>`;
  const ctxRow = ctx ? `<div class="card-ctx now-ctx ${ctx.level}" style="--p:${ctx.p}%"><i></i><b>컨텍스트 ${ctx.p}%</b><small>${esc(ctx.text)}</small></div>` : '';
  const live = viewMode !== 'demo' && viewMode !== 'replay' && info.file;
  const acts = !a.intern && live
    ? `<div class="card-acts"><button type="button" data-act="replay">⏪ 처음부터 다시 보기</button>${viewMode === 'file' ? '' : '<button type="button" data-act="pin">📌 이 세션만 보기</button>'}</div>`
    : '';
  const html = `<button class="card-x" type="button" data-act="close" aria-label="닫기">✕</button><div class="card-head" style="--wc:${s.color}">${head}</div>`
    + `<div class="card-now">${esc(a.now.icon)} ${esc(a.now.title)}${a.now.time ? ` <time>${esc(a.now.time)}</time>` : ''}${a.now.sub ? `<small>${esc(clip(a.now.sub, 120))}</small>` : ''}</div>`
    + ctxRow + nums + acts;
  const card = $('card');
  if (html !== cardHtml) card.innerHTML = cardHtml = html;
  card.hidden = false;
  // 캐릭터 오른쪽 위에 붙이되 무대 밖으로 나가지 않게
  const w = card.offsetWidth, h = card.offsetHeight;
  card.style.left = Math.max(8, Math.min(a.x + 34, W - w - 8)) + 'px';
  card.style.top = Math.max(8, Math.min(a.y - h - 20, H - h - 8)) + 'px';
}

// ───────────────────────── 서버 연결 ─────────────────────────
function resetAll() {
  for (const sid of [...sessions.keys()]) removeSession(sid);
  floors.clear();
  feed.clear();
  seenWaits.clear();
  current = null;
  boardSid = null;
  setBoard(null, false);
  $('userBubble').classList.remove('show');
}

function onHello(d) {
  resetAll();
  viewMode = d.mode || viewMode;
  $('emptyRoot').textContent = d.root ? `찾는 위치: ${d.root}` : '';
  for (const snap of d.sessions || []) addSession(snap);
  // 활동 기록: 모든 세션의 지난 기록을 시간 순으로 섞어서
  const items = [];
  for (const snap of d.sessions || []) {
    const s = sessions.get(snap.sid);
    if (!s) continue;
    for (const ev of (snap.history || []).slice(-90)) items.push([s, s.main, ev]);
    for (const ag of snap.agents || []) for (const ev of (ag.history || []).slice(-20)) items.push([s, s.interns.get(ag.id), ev]);
    if (s.wait) items.push([s, s.main, { ...s.wait, k: 'wait' }]);
  }
  items.sort((x, y) => (x[2].ts || 0) - (y[2].ts || 0));
  for (const [s, a, ev] of items.slice(-150)) feed.add(s, a, ev);
  current = busiestFloor();
  refreshBoard();
  render();
  loadSessions();
}

function onJoin(snap) {
  const s = addSession(snap);
  for (const ev of (snap.history || []).slice(-20)) feed.add(s, s.main, ev);
  if (!current) current = s.floor;
  if (s.wait) {
    // 보고 있지 않던 세션이 권한을 기다려서 빌딩에 들어온 경우
    if (Date.now() - s.wait.ts < 60000) alerts.notifyWait(s, s.wait);
    if (floorAuto && s.floor !== current) goFloor(s.floor);
  }
  refreshBoard();
  render();
}

function setConn(state, text) {
  $('conn').dataset.state = state;
  $('conn').querySelector('span').textContent = text;
}

function connect() {
  if (es) es.close();
  const want = $('sessionSelect').value || 'all';
  viewMode = want === 'all' || want === 'auto' ? want : 'file';
  es = new EventSource('/api/stream?file=' + encodeURIComponent(want));
  setConn('wait', '연결 중…');
  es.onopen = () => setConn('live', '실시간 · 0.25초 간격');
  es.onerror = () => setConn('off', '재연결 중…');
  es.addEventListener('hello', e => { setConn('live', '실시간 · 0.25초 간격'); onHello(JSON.parse(e.data)); });
  es.addEventListener('join', e => onJoin(JSON.parse(e.data)));
  es.addEventListener('leave', e => retireSession(JSON.parse(e.data).sid));
  es.addEventListener('events', e => { for (const u of JSON.parse(e.data).updates || []) applyUpdate(u); });
}

// ───────────────────────── 세션 목록 ─────────────────────────
const isFile = v => v && v !== 'all' && v !== 'auto';
// keepFile: 처음 켤 때 저장해 둔 고정 세션 (그 뒤로는 지금 고른 값)
async function loadSessions(keepFile) {
  const sel = $('sessionSelect');
  const keep = keepFile || sel.value;
  let d;
  try { d = await (await fetch('/api/sessions' + (isFile(keep) ? '?keep=' + encodeURIComponent(keep) : ''))).json(); } catch { return; }
  sel.innerHTML = '<option value="all">🏢 빌딩 · 최근 30분 세션 모두</option><option value="auto">자동 · 가장 최근 세션 하나</option>';
  for (const s of d.sessions || []) {
    const o = document.createElement('option');
    o.value = s.file;
    o.textContent = `${s.file === keep ? '📌 ' : sessions.has(s.id) ? '● ' : ''}${s.waiting ? '🔐 ' : ''}${s.project} — ${clip(s.title, 34)} · ${ago(s.mtime)}`;
    sel.appendChild(o);
  }
  if ([...sel.options].some(o => o.value === keep)) {
    sel.value = keep;
  } else if (isFile(keep)) {
    // 고정해 둔 세션 기록이 없어졌다: 빌딩으로 돌아간다
    sel.value = 'all';
    try { localStorage.setItem(VIEW_KEY, 'all'); } catch { /* 저장소 없음 */ }
    if (viewMode === 'file' && !demo) {
      toast('📌 고정한 세션 기록이 없어져서 빌딩으로 돌아왔어요');
      connect();
    }
  }
}

// ───────────────────────── 데모 ─────────────────────────
function startDemo() {
  stopDemo(false);
  replay.stop(false);
  if (es) { es.close(); es = null; }
  floorAuto = true;
  onHello({ mode: 'demo', root: '', sessions: DEMO_SESSIONS.map(s => ({ ...s, session: { ...s.session, mtime: Date.now() }, stats: emptyStats() })) });
  setConn('demo', '데모 재생 중');
  demo = [];
  let t = 0;
  for (const [d, sid, ev] of DEMO_SCRIPT) {
    t += d;
    demo.push(setTimeout(() => {
      const s = sessions.get(sid);
      if (!s) return;
      // { wait } 항목은 hook이 알려 주는 권한 확인 대기를 흉내 낸다
      if ('wait' in ev) setWait(s, ev.wait && { ...ev.wait, ts: Date.now() });
      else applyUpdate({ sid, events: [{ ...ev, ts: Date.now() }] });
    }, t));
  }
  demo.push(setTimeout(() => stopDemo(true), t + 9000));
  $('demoBtn').textContent = '데모 끝내기';
  $('demoBtn').classList.add('stop');
}
function stopDemo(reconnect) {
  if (!demo) return;
  demo.forEach(clearTimeout);
  demo = null;
  $('demoBtn').textContent = '데모 보기';
  $('demoBtn').classList.remove('stop');
  if (reconnect) connect();
}

// ───────────────────────── 도움말 ─────────────────────────
// 방이 뭘 하는 곳인지, 캐릭터 모습이 무슨 뜻인지, 무엇을 누르고 어떤 키를 쓰는지 한눈에 (❔ 버튼이나 ? 키)
function buildHelp() {
  const rows = list => list.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  const rooms = ROOM_IDS.map(id => [`${ROOMS[id].icon} ${ROOMS[id].name}`, ROOMS[id].sub]);
  $('helpBody').innerHTML = `
    <h3>방</h3><dl>${rows(rooms)}</dl>
    <p class="help-tip">도구에 따라 캐릭터가 이 방들을 오가요. 처음 보는 도구는 이름을 보고 방을 골라요.</p>
    <h3>캐릭터 모습</h3><dl>${rows([
      ['💭 구름 말풍선', '생각하는 중'],
      ['😰 식은땀, 빨간 말풍선', '도구가 실패했어요'],
      ['🔐 허락서를 들고 내 자리에', '권한 확인 창이 떠서 내 허락을 기다려요 (hooks가 켜져 있을 때)'],
      ['❓ 노란 말풍선', '나에게 물어볼 게 있어요'],
      ['✅ 완료', '답을 마치고 다음 지시를 기다려요'],
      ['😴 졸기', '한동안 할 일이 없어요'],
      ['작은 캐릭터', '인턴 = 서브에이전트. 일을 마치면 퇴근해요'],
      ['📏 위쪽 막대', '컨텍스트가 얼마나 찼는지 (빨개지면 곧 요약돼요)'],
    ])}</dl>
    <h3>누르기</h3><dl>${rows([
      ['캐릭터', '정보 카드: 지금 하는 일, 컨텍스트, 다시 보기·이 세션만 보기'],
      ['로비 안내판·활동 기록 줄', '그 사람이 있는 층으로 가서 정보 카드 열기'],
      ['층 버튼 · 🛗 자동', '층 고르기 · 일이 생기는 층으로 알아서'],
      ['⏪ 다시 보기', '세션을 처음부터 빠르게 (⏸ 멈춤, 10× 빠르기, 노란 막대를 누르면 건너뛰기)'],
      ['📓 업무 일지', '오늘 한 일을 프로젝트별로'],
      ['🔔 알림', '다른 창을 볼 때 권한 대기·질문·응답 완료를 알려 줘요'],
    ])}</dl>
    <h3>단축키</h3><dl>${rows([
      ['<kbd>1</kbd>~<kbd>9</kbd> · <kbd>0</kbd>', '그 층으로 · 층 자동'],
      ['<kbd>Space</kbd> · <kbd>←</kbd> <kbd>→</kbd>', '다시 보기 멈추기 · 5%씩 앞뒤로'],
      ['<kbd>?</kbd> · <kbd>Esc</kbd>', '이 도움말 · 창 닫기'],
    ])}</dl>`;
}
function openHelp() {
  if (!$('helpBody').innerHTML) buildHelp();
  $('help').hidden = false;
}
function closeHelp() {
  $('help').hidden = true;
}

// ───────────────────────── 시작 ─────────────────────────
buildFloor($('floor'));
buildChrome();
fit();
new ResizeObserver(fit).observe(el.wrap);

let lastT = performance.now();
function step() {
  const t = performance.now();
  const dt = Math.min(1, (t - lastT) / 1000);
  lastT = t;
  for (const a of actors) a.step(dt);
}
(function frame() { step(); requestAnimationFrame(frame); })();
// 탭이 가려져 rAF가 멈춰도 걸음이 멈추지 않게 타이머로도 한 번씩 진행시킨다
setInterval(() => { if (performance.now() - lastT > 150) step(); }, 100);
setInterval(() => { for (const a of actors) if (!a.running) a.rest(); retireInterns(); }, 500);
setInterval(() => { autoFloor(); render(); }, 250);

$('floorTabs').addEventListener('click', e => {
  const b = e.target.closest('[data-floor]');
  if (b) goFloor(b.dataset.floor, true);
});
$('floorAuto').addEventListener('click', () => { floorAuto = true; autoFloor(); render(); });
// 로비 안내판 줄이나 활동 기록 줄을 누르면 그 층으로 가서, 그 사람의 정보 카드를 연다
function showActor(li) {
  if (!li) return;
  goFloor(li.dataset.floor, true);
  const a = [...actors].find(x => x.key === li.dataset.actor && !x.leaving);
  if (a) openCard(a, true);
}
$('lobby').addEventListener('click', e => showActor(e.target.closest('[data-floor]')));
el.feed.addEventListener('click', e => showActor(e.target.closest('[data-floor]')));

const sel = $('sessionSelect');
const VIEW_KEY = 'claude-office-view';
sel.addEventListener('change', () => {
  try { localStorage.setItem(VIEW_KEY, sel.value); } catch { /* 저장소 없음 */ }
  stopDemo(false);
  replay.stop(false);
  floorAuto = true;
  connect();
});
$('demoBtn').addEventListener('click', () => (demo ? stopDemo(true) : startDemo()));
$('card').addEventListener('click', e => {
  e.stopPropagation();
  const act = e.target.closest('[data-act]');
  const s = cardActor && sessions.get(cardActor.sid);
  if (!act || !s) return;
  if (act.dataset.act === 'close') return closeCard();
  closeCard();
  if (act.dataset.act === 'replay') replay.start(s.info.file);
  if (act.dataset.act === 'pin') {
    sel.value = s.info.file;
    sel.dispatchEvent(new Event('change'));
  }
});
el.stage.addEventListener('click', () => closeCard()); // 빈 곳을 누르면 닫기
$('helpBtn').addEventListener('click', openHelp);
$('helpClose').addEventListener('click', closeHelp);
$('help').addEventListener('click', e => { if (e.target === e.currentTarget) closeHelp(); });
// 단축키: Space 다시 보기 멈춤·이어 보기, ←·→ 다시 보기 5%씩 이동, 1~9 그 층으로, 0 층 자동
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || (e.target.closest && e.target.closest('input, select, textarea'))) return;
  if (cardActor && e.key === 'Escape') return closeCard();
  if (!$('help').hidden) {
    if (e.key === 'Escape' || e.key === '?') closeHelp();
    return;
  }
  if (journal.isOpen()) {
    if (e.key === 'Escape') journal.close();
    return;
  }
  if (e.key === '?') return openHelp();
  if (replay.isOn() && e.key === ' ') {
    e.preventDefault();
    replay.togglePause();
  } else if (replay.isOn() && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    replay.seekBy(e.key === 'ArrowRight' ? 0.05 : -0.05);
  } else if (/^[1-9]$/.test(e.key)) {
    const key = [...floors.keys()][Number(e.key) - 1];
    if (key) goFloor(key, true);
  } else if (e.key === '0') {
    floorAuto = true;
    autoFloor();
    render();
  }
});
let saved = 'all';
try { saved = localStorage.getItem(VIEW_KEY) || 'all'; } catch { /* 저장소 없음 */ }
loadSessions(saved).then(() => {
  sel.value = [...sel.options].some(o => o.value === saved) ? saved : 'all';
  // ?demo 로 열면 실제 세션 대신 데모부터 재생하고, 끝나면 실시간 추적으로 넘어간다
  if (new URLSearchParams(location.search).has('demo')) startDemo();
  else connect();
});
setInterval(loadSessions, 15000);

// 콘솔에서 이벤트를 직접 넣어 볼 수 있게 (예: officeDebug.ingest([{k:'think', text:'테스트'}]))
window.officeDebug = {
  ingest: (evs, sid) => applyUpdate({ sid: sid || [...sessions.keys()][0], events: evs.map(e => ({ ts: Date.now(), ...e })) }),
  wait: (w, sid) => {
    const s = sessions.get(sid || [...sessions.keys()][0]);
    if (s) setWait(s, w && { ts: Date.now(), kind: 'permission', ...w });
  },
  goFloor: key => goFloor(key, true),
  join: snap => onJoin(snap),
  leave: sid => retireSession(sid),
  state: () => ({
    floor: current, floorAuto, viewMode,
    floors: [...floors.values()].map(f => ({ key: f.key, name: f.name, sids: [...f.sids] })),
    actors: [...actors].map(a => ({
      key: a.key, intern: a.intern, floor: a.floor, room: a.room, slot: a.slot, x: Math.round(a.x), y: Math.round(a.y),
      mode: a.mode, status: a.status, queue: a.queue.length, pending: [...a.pending.keys()], bubble: a.bubbleKind, wait: !!a.waitState,
    })),
  }),
};
