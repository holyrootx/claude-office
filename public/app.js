// Claude 사무실 — 서버가 보내는 세션 이벤트를 받아 층마다 직원(세션)과 인턴(서브에이전트)을 움직인다.
import { $, esc, clip, hhmmss, ago } from './js/util.js';
import { W, H, ROOMS, ROOM_IDS, buildFloor } from './js/scene.js';
import { Actor } from './js/actor.js';
import { DEMO_SESSIONS, DEMO_SCRIPT } from './js/demo.js';

const COLORS = ['#D97757', '#4C8BF5', '#2FA36B', '#9B6CE8', '#E0607E', '#D49A1F', '#1FA3A3', '#7C8799'];
const STATUS_ORDER = { wait: 0, ask: 1 };
const emptyStats = () => ({ library: 0, dev: 0, server: 0, search: 0, meeting: 0, desk: 0, tools: 0, errors: 0, prompts: 0 });
const shortName = info => clip(info.title || info.project || '세션', 18);

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
  remove(actor) {
    actors.delete(actor);
    const s = sessions.get(actor.sid);
    if (s && s.interns.get(actor.agent) === actor) s.interns.delete(actor.agent);
    actor.destroy();
  },
};

// ───────────────────────── 화면 뼈대 ─────────────────────────
const el = { stage: $('stage'), box: $('stageBox'), wrap: $('stageWrap'), feed: $('feed'), board: $('board') };
const signs = {}, statRows = {};

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
    feedAdd(s, a, ev);
    if (ev.k === 'tool' && ev.ask) notify(s, '❓ 물어볼 게 있어요', ev.ask);
    if (ev.k === 'say' && ev.final && !ev.agent) notify(s, '✅ 응답 완료', ev.text);
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
    feedAdd(s, target, { ...w, k: 'wait' });
    notifyWait(s, w);
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
  const key = [st.icon, st.title, sub, st.room, st.mode, st.time].join('|');
  if (key !== nowKey) {
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
  setFavicon(waiting);
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
          html: `<li class="lb ${st}${a.floor === current ? ' here' : ''}${a.intern ? ' intern' : ''}" data-floor="${esc(f.key)}" style="--wc:${s.color}">`
            + `<b>${i + 1}F</b><span class="nm">${a.intern ? '<em>인턴</em>' : ''}${esc(a.name)}</span>`
            + `<span class="st">${esc(a.now.icon)} ${esc(clip(a.now.title, 24))}</span><time>${esc(a.now.time || '')}</time></li>`,
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
      meta = [...where, viewMode === 'auto' ? '자동 추적' : ''].filter(Boolean).join(' · ');
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
  $('empty').hidden = sessions.size > 0 || viewMode === 'demo';
}

// ───────────────────────── 활동 기록 ─────────────────────────
const feedItems = new Map();
const feedKnown = new Map();
function feedAdd(s, a, ev) {
  let ic = '', cls = '', tx = '', room = '';
  switch (ev.k) {
    case 'agent': ic = '👋'; cls = 'agent'; tx = `<b>${esc(ev.type || '서브에이전트')} 인턴 출근</b> ${esc(ev.desc || '')}`; break;
    case 'user':
      if (ev.agent) { ic = '📋'; cls = 'think'; tx = `<b>맡은 일</b> ${esc(clip(ev.text, 140))}`; break; }
      ic = '🙋'; cls = 'user'; tx = `<b>나</b> ${esc(ev.text)}`;
      break;
    case 'think': if (!ev.text) return; ic = '💭'; cls = 'think'; tx = esc(ev.text); break;
    case 'say': ic = ev.final ? '✅' : '💬'; cls = 'say'; tx = esc(clip(ev.text, 160)); if (ev.final) room = 'desk'; break;
    case 'tool': {
      const r = ROOMS[ev.room] || ROOMS.dev;
      ic = r.icon; room = ev.room;
      feedKnown.set(ev.id, ev);
      if (feedKnown.size > 1500) feedKnown.delete(feedKnown.keys().next().value);
      tx = `${ev.git ? '<b style="color:#f05033">git</b> ' : ''}<b>${esc(ev.tool)}</b> ${esc(ev.label || '')}<span class="st"></span><small>${esc(r.name)}${ev.detail && ev.detail !== ev.label ? ' · ' + esc(ev.detail) : ''}</small>`;
      break;
    }
    case 'result': {
      const li = feedItems.get(ev.id);
      if (li) li.classList.add(ev.ok ? 'ok' : 'fail');
      if (ev.ok && ev.answer) { ic = '🙋'; cls = 'user'; tx = `<b>나</b> 답변: ${esc(ev.answer)}`; break; }
      if (ev.ok) return;
      const t = feedKnown.get(ev.id);
      ic = '😰'; cls = 'err'; tx = `<b>${esc((t && t.tool) || ev.name || '도구')} 실패</b> ${esc(ev.error)}`;
      break;
    }
    case 'wait':
      ic = '🔐'; cls = 'wait';
      tx = `<b>${ev.kind === 'input' ? '입력 대기' : '권한 확인 대기'}</b> ${ev.tool ? `${esc(ev.tool)} ${esc(ev.label || '')}` : esc(ev.text || '')}`;
      break;
    case 'interrupt': ic = '✋'; cls = 'err'; tx = '사용자가 작업을 중단했어요'; break;
    case 'compact': ic = '🗜'; tx = '대화 압축(요약)'; break;
    case 'apierr': ic = '⚠'; cls = 'err'; tx = `<b>API 오류</b> ${esc(ev.text)}`; break;
    default: return;
  }
  // 여러 세션이나 인턴이 있으면 누가 한 일인지 이름표를 붙인다
  const who = a && (a.intern || sessions.size > 1)
    ? `<span class="who" style="--wc:${s.color}">${a.intern ? '인턴 · ' : ''}${esc(a.name)}</span>`
    : '';
  const li = document.createElement('li');
  if (cls) li.className = cls;
  if (room) li.dataset.room = room;
  li.dataset.floor = s.floor;
  li.innerHTML = `<time>${hhmmss(ev.ts || Date.now())}</time><span class="ic">${ic}</span><div class="tx">${who}${tx}</div>`;
  if (ev.k === 'tool') feedItems.set(ev.id, li);
  el.feed.prepend(li);
  while (el.feed.children.length > 200) {
    const last = el.feed.lastElementChild;
    for (const [k, v] of feedItems) if (v === last) feedItems.delete(k);
    last.remove();
  }
}

// ───────────────────────── 알림 ─────────────────────────
// 다른 창을 보고 있을 때 누가 나를 기다리면 브라우저 알림으로 알려 준다. 🔔 버튼으로 켜고, 기본은 꺼져 있다.
const NOTIFY_KEY = 'claude-office-notify';
let notifyOn = false;
try { notifyOn = localStorage.getItem(NOTIFY_KEY) === '1'; } catch { /* 저장소 없음 */ }
const canNotify = () => 'Notification' in window && Notification.permission === 'granted';

function notify(s, title, body) {
  if (!notifyOn || !canNotify() || viewMode === 'demo') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return; // 이미 보고 있다
  const floor = s.floor;
  // 같은 세션 알림은 tag로 하나만 남긴다
  const n = new Notification(title, { body: `${s.main.name} · ${clip(body, 120)}`, tag: 'claude-office-' + s.sid, icon: faviconUrl(0) });
  n.onclick = () => {
    window.focus();
    goFloor(floor);
    n.close();
  };
}
function notifyWait(s, w) {
  const what = w.tool ? `${w.tool} ${w.label || ''}` : w.text || '';
  notify(s, w.kind === 'input' ? '🔐 입력을 기다려요' : '🔐 실행 허락을 기다려요', what);
}

async function toggleNotify() {
  if (!('Notification' in window)) return renderNotifyBtn('이 브라우저는 알림을 지원하지 않아요');
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission === 'denied') {
    notifyOn = false;
    return renderNotifyBtn('브라우저 설정에서 이 페이지의 알림이 막혀 있어요');
  }
  notifyOn = !notifyOn && canNotify();
  try { localStorage.setItem(NOTIFY_KEY, notifyOn ? '1' : '0'); } catch { /* 저장소 없음 */ }
  renderNotifyBtn();
  if (notifyOn) toast('🔔 다른 창을 볼 때 기다리는 일이 생기면 알려 드려요');
}
function renderNotifyBtn(why) {
  const b = $('notifyBtn');
  const on = notifyOn && canNotify();
  b.textContent = on ? '🔔' : '🔕';
  b.classList.toggle('on', on);
  b.title = why || (on ? '알림 켜짐: 다른 창을 볼 때 권한 대기·질문·응답 완료를 알려요 (누르면 끔)' : '알림 꺼짐: 누르면 켜요');
  if (why) toast(why);
}

// 탭 아이콘: Claude 얼굴, 기다리는 사람이 있으면 빨간 숫자
let faviconKey = -1;
function faviconUrl(n) {
  const badge = n ? `<circle cx="48" cy="16" r="15" fill="#ef4444"/><text x="48" y="22" font-size="19" font-weight="700" text-anchor="middle" fill="#fff" font-family="sans-serif">${n > 9 ? '9+' : n}</text>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="8" y="12" width="46" height="44" rx="19" fill="#D97757"/><ellipse cx="24" cy="32" rx="3.4" ry="4.4" fill="#2b1d16"/><ellipse cx="38" cy="32" rx="3.4" ry="4.4" fill="#2b1d16"/><path d="M27 41 q4 4 8 0" stroke="#2b1d16" stroke-width="2.6" fill="none" stroke-linecap="round"/>${badge}</svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
function setFavicon(n) {
  if (n === faviconKey) return;
  faviconKey = n;
  $('favicon').href = faviconUrl(n);
}

// ───────────────────────── 서버 연결 ─────────────────────────
function resetAll() {
  for (const sid of [...sessions.keys()]) removeSession(sid);
  floors.clear();
  feedItems.clear();
  feedKnown.clear();
  seenWaits.clear();
  el.feed.innerHTML = '';
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
  for (const [s, a, ev] of items.slice(-150)) feedAdd(s, a, ev);
  current = busiestFloor();
  refreshBoard();
  render();
  loadSessions();
}

function onJoin(snap) {
  const s = addSession(snap);
  for (const ev of (snap.history || []).slice(-20)) feedAdd(s, s.main, ev);
  if (!current) current = s.floor;
  if (s.wait) {
    // 보고 있지 않던 세션이 권한을 기다려서 빌딩에 들어온 경우
    if (Date.now() - s.wait.ts < 60000) notifyWait(s, s.wait);
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
  es.addEventListener('leave', e => { removeSession(JSON.parse(e.data).sid); render(); });
  es.addEventListener('events', e => { for (const u of JSON.parse(e.data).updates || []) applyUpdate(u); });
}

// ───────────────────────── 세션 목록 ─────────────────────────
async function loadSessions() {
  let d;
  try { d = await (await fetch('/api/sessions')).json(); } catch { return; }
  const sel = $('sessionSelect');
  const keep = sel.value;
  sel.innerHTML = '<option value="all">🏢 빌딩 · 최근 30분 세션 모두</option><option value="auto">자동 · 가장 최근 세션 하나</option>';
  for (const s of d.sessions || []) {
    const o = document.createElement('option');
    o.value = s.file;
    o.textContent = `${sessions.has(s.id) ? '● ' : ''}${s.waiting ? '🔐 ' : ''}${s.project} — ${clip(s.title, 34)} · ${ago(s.mtime)}`;
    sel.appendChild(o);
  }
  if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
}

// ───────────────────────── 데모 ─────────────────────────
function startDemo() {
  stopDemo(false);
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
$('lobby').addEventListener('click', e => {
  const li = e.target.closest('[data-floor]');
  if (li) goFloor(li.dataset.floor, true);
});

const sel = $('sessionSelect');
const VIEW_KEY = 'claude-office-view';
sel.addEventListener('change', () => {
  try { localStorage.setItem(VIEW_KEY, sel.value); } catch { /* 저장소 없음 */ }
  stopDemo(false);
  floorAuto = true;
  connect();
});
$('demoBtn').addEventListener('click', () => (demo ? stopDemo(true) : startDemo()));
$('notifyBtn').addEventListener('click', toggleNotify);
renderNotifyBtn();
loadSessions().then(() => {
  let saved = 'all';
  try { saved = localStorage.getItem(VIEW_KEY) || 'all'; } catch { /* 저장소 없음 */ }
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
  state: () => ({
    floor: current, floorAuto, viewMode,
    floors: [...floors.values()].map(f => ({ key: f.key, name: f.name, sids: [...f.sids] })),
    actors: [...actors].map(a => ({
      key: a.key, intern: a.intern, floor: a.floor, room: a.room, slot: a.slot, x: Math.round(a.x), y: Math.round(a.y),
      mode: a.mode, status: a.status, queue: a.queue.length, pending: [...a.pending.keys()], bubble: a.bubbleKind, wait: !!a.waitState,
    })),
  }),
};
