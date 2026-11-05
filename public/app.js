// Claude 사무실 — 서버가 보내는 세션 이벤트를 받아 층마다 직원(세션)과 인턴(서브에이전트)을 움직인다.
import { $, esc, clip, ago, resumeCommand, ctxOf, codeNotice } from './js/util.js';
import { cardHtml as buildCard } from './js/card.js';
import { lobbyHtml as buildLobby } from './js/lobby.js';
import { helpHtml, hooksLine } from './js/help.js';
import { W, H, ROOMS, ROOM_IDS, buildFloor } from './js/scene.js';
import { Actor } from './js/actor.js';
import { DEMO_SESSIONS, DEMO_SCRIPT } from './js/demo.js';
import { createFeed } from './js/feed.js';
import { createAlerts } from './js/alerts.js';
import { createJournal } from './js/journal.js';
import { createReplay } from './js/replay.js';
import { firstFloor, nextFloor, floorLabel } from './js/floors.js';

const COLORS = ['#D97757', '#4C8BF5', '#2FA36B', '#9B6CE8', '#E0607E', '#D49A1F', '#1FA3A3', '#7C8799'];
const emptyStats = () => ({ library: 0, dev: 0, server: 0, search: 0, meeting: 0, desk: 0, tools: 0, errors: 0, prompts: 0 });
const shortName = info => clip(info.title || info.project || '세션', 18);
// 컨텍스트가 얼마나 찼는지: 비율과 색 단계

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
const feed = createFeed(el.feed, { manyPeople: () => sessions.size > 1, onFails: n => renderFeedFails(n) });
const alerts = createAlerts({ toast: (...a) => toast(...a), goFloor: key => goFloor(key), quiet: () => viewMode === 'demo' || viewMode === 'replay' });
// 나를 기다리거나 일이 끝났을 때: 브라우저 알림(켜 두었으면) + 화면 읽기 프로그램에 읽어 주기.
// 탭 제목이 바뀌는 건 화면 읽기 프로그램이 읽어 주지 않아서 따로 알린다 (데모·다시 보기 중에는 조용히).
function announce(text) {
  if (viewMode === 'demo' || viewMode === 'replay') return;
  const el = $('announce');
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 60); // 같은 말이 또 와도 다시 읽게 비웠다가 넣는다
}
function tell(s, title, body) {
  alerts.notify(s, title, body);
  announce(`${s.main.name}: ${title.replace(/^\S+\s/, '')}. ${clip(body || '', 100)}`);
}
function tellWait(s, w) {
  alerts.notifyWait(s, w);
  announce(`${s.main.name}: ${w.kind === 'input' ? '내 입력을 기다려요' : '실행 허락을 기다려요'}. ${w.tool ? `${w.tool} ${w.label || ''}` : w.text || ''}`);
}
const journal = createJournal({ toast: (...a) => toast(...a), onPick: file => replay.start(file), copy: text => copyText(text) });
const replay = createReplay({
  pickFile: () => {
    const focus = focusActor([...actors].filter(a => a.floor === current));
    return isFile(sel.value) ? sel.value : focus && sessions.get(focus.sid) && sessions.get(focus.sid).info.file;
  },
  beforeStart: () => {
    stopDemo(false);
    disconnect();
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
  // 감싼 칸의 실제 안쪽 여백만큼 빼고 맞춘다 (좁은 화면은 여백이 작다)
  const cs = getComputedStyle(el.wrap);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 4;
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + 4;
  const narrow = matchMedia('(max-width: 1100px)').matches;
  const byWidth = (el.wrap.clientWidth - padX) / W;
  const s = narrow ? byWidth : Math.min(byWidth, (el.wrap.clientHeight - padY) / H, 1.6);
  // 폰 화면(375px)에서도 옆으로 삐져나가지 않게 아주 작게까지 줄인다
  const scale = Math.max(0.15, s);
  el.stage.style.transform = `scale(${scale})`;
  el.box.style.width = W * scale + 'px';
  el.box.style.height = H * scale + 'px';
  // 정보 카드는 무대와 같이 줄어들면 못 읽으니까, 무대가 작을 때는 그만큼 다시 키운다 (화면에서 300px 가까이)
  cardK = Math.max(1, 0.85 / scale);
  if (cardActor) renderCard();
  // 처음 화면의 안내 상자도 같은 만큼 키우되 무대 너비(1280) 안에 들어오게
  $('empty').style.setProperty('--k', Math.min(cardK, (W - 40) / 520).toFixed(3));
}
let cardK = 1;

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
  // 층: 프로젝트 폴더마다 하나 (워크트리에서 시작한 세션도 원래 프로젝트 층으로)
  const key = info.home || info.cwd || info.project || snap.sid;
  if (!floors.has(key)) floors.set(key, { key, name: info.project || clip(key, 20), sids: new Set() });
  floors.get(key).sids.add(snap.sid);
  const s = {
    sid: snap.sid, info, floor: key, color: pickColor(snap.sid), interns: new Map(),
    plan: snap.plan || null, planAt: snap.plan ? 1 : 0, stats: snap.stats || emptyStats(), wait: snap.wait || null,
  };
  sessions.set(s.sid, s);
  const w = s.wait;
  const internIds = new Set((snap.agents || []).map(a => a.id));
  s.main = new Actor(office, { key: s.sid, sid: s.sid, name: shortName(info), color: s.color, floor: key });
  actors.add(s.main);
  s.main.load(snap.history || [], w && !(w.on && internIds.has(w.on)) ? w : null);
  for (const a of snap.agents || []) addIntern(s, a).load(a.history || [], w && w.on === a.id ? w : null);
  if (snap.compacting) s.main.setCompacting(snap.compacting);
  if (w) seenWaits.add(waitId(s.sid, w));
  return s;
}

// 직원 색: 처음 출근한 직원은 늘 Claude 주황, 그다음부터는 세션 id로 정한다.
// 그래서 새로 고쳐도, 다른 탭에서 봐도 같은 세션은 대개 같은 색이다. 지금 빌딩에 같은 색이 있으면 다음 색을 쓴다.
function pickColor(sid) {
  if (colorOf.has(sid)) return colorOf.get(sid);
  const used = new Set([...sessions.values()].map(s => s.color));
  let color = COLORS[0];
  if (used.size) {
    let h = 0;
    for (const c of sid) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const rest = COLORS.slice(1);
    let i = h % rest.length;
    for (let n = 0; n < rest.length && used.has(rest[i]); n++) i = (i + 1) % rest.length;
    color = rest[i];
  }
  colorOf.set(sid, color);
  return color;
}

function addIntern(s, a) {
  const it = new Actor(office, { key: `${s.sid}:${a.id}`, sid: s.sid, agent: a.id, intern: true, name: a.type || '인턴', color: s.color, floor: s.floor });
  it.desc = a.desc || '';
  // 정보 카드의 '도구 n번 · n분째': 화면이 받지 못한 앞부분까지 (서버가 알려 준다)
  if (a.startTs) it.firstTs = a.startTs;
  it.toolCount = a.toolsBefore || 0;
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
        a = addIntern(s, { id: ev.agent, type: ev.k === 'agent' ? ev.type : '', desc: ev.desc, startTs: ev.startTs, toolsBefore: ev.toolsBefore });
        a.appearInHall(ROOMS.meeting.door);
      }
    }
    if (!u.stats) countLocal(s, ev);
    feed.add(s, a, ev);
    if (ev.k === 'tool' && ev.ask) tell(s, '❓ 물어볼 게 있어요', ev.ask);
    if (ev.k === 'say' && ev.final && !ev.agent) tell(s, '✅ 응답 완료', ev.text);
    // 사용 한도나 오류로 끝내 멈췄을 때도 알린다 (응답 완료가 오지 않으니까)
    if (ev.k === 'apierr' && ev.stop && !ev.agent) {
      tell(s, ev.kind === 'limit' ? '⏳ 사용 한도에 걸렸어요' : '⚠ 오류로 일이 멈췄어요', ev.kind === 'limit' ? (ev.resets ? `${ev.resets}에 다시 열려요` : '한도가 풀리면 다시 일해요') : ev.text);
    }
    if (!batches.has(a)) batches.set(a, []);
    batches.get(a).push(ev);
  }
  for (const [a, evs] of batches) a.ingest(evs);
  if ('wait' in u) setWait(s, u.wait);
  if ('compacting' in u) s.main.setCompacting(u.compacting);
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
    tellWait(s, w);
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
const floorName = key => floorLabel(floors, key);

function goFloor(key, pin) {
  if (pin) floorAuto = false;
  if (!floors.has(key)) return;
  if (key !== current) {
    current = key;
    toast(`🛗 ${floorNum(key)}F · ${floorName(key)}`);
    el.stage.classList.remove('arrive');
    void el.stage.offsetWidth;
    el.stage.classList.add('arrive');
    $('userBubble').classList.remove('show');
    refreshBoard();
  }
  render();
}

const busiestFloor = () => firstFloor(actors, [...floors.keys()]);

// 자동으로 층 옮기기 (어느 층으로 갈지는 floors.js의 nextFloor가 정한다)
function autoFloor() {
  if (!current || !floors.has(current)) {
    current = busiestFloor();
    refreshBoard();
    return;
  }
  if (!floorAuto || floors.size < 2) return;
  const to = nextFloor(current, actors);
  if (to) goFloor(to);
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
  // ⏳는 '사용 한도'에 쓰니까 빈 상태는 다른 그림으로
  const st = a ? a.now : { icon: sessions.size ? '🏢' : '🔍', title: sessions.size ? '이 층은 비어 있어요' : '따라갈 세션이 없어요', sub: '', room: 'desk', mode: '', time: '' };
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
      + `<b>${i + 1}F</b>${esc(floorName(f.key))}<small>${on.length}명</small>${wait ? '<i>🔐</i>' : ''}</button>`;
  }).join('');
  if (html !== floorbarHtml) $('floorTabs').innerHTML = floorbarHtml = html;
}

let lobbyHtml = '';
function renderLobby() {
  const html = buildLobby([...floors.values()], sessions, current);
  if (html !== lobbyHtml) {
    // 다시 그려도 키보드로 고르던 줄은 그대로 고른 채로
    const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest('#lobby [data-actor]');
    const key = focused && focused.dataset.actor;
    $('lobby').innerHTML = lobbyHtml = html;
    if (key) {
      const again = [...$('lobby').querySelectorAll('[data-actor]')].find(li => li.dataset.actor === key);
      if (again) again.focus({ preventScroll: true });
    }
  }
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
  for (const a of actors) {
    a.wrap.hidden = a.floor !== current;
    if (!a.wrap.hidden) a.setPile(a.intern ? 0 : (ctxOf(sessions.get(a.sid)) || {}).p); // 컨텍스트 서류 더미
  }
  // 이름표: 인턴은 늘, 직원은 같은 층에 둘 이상일 때
  const mains = here.filter(a => !a.intern).length;
  for (const a of here) a.setTag(a.intern ? a.name : mains > 1 ? a.name : '');
  highlight(new Set(here.filter(a => !a.leaving && a.hl).map(a => a.hl)));
  const focus = focusActor(here.filter(a => !a.leaving));
  renderNow(focus, here.length > 1);
  renderFloorbar();
  renderLobby();
  renderStats();
  renderFeedScope();
  renderHeader(focus);
  renderCard();
  $('empty').hidden = sessions.size > 0 || viewMode === 'demo';
}

// 활동 기록 '이 층만': 층이 둘 이상일 때만 버튼이 보이고, 고른 것은 기억해 둔다
const FEED_KEY = 'claude-office-feed-floor';
let feedThisFloor = false, feedScope;
try { feedThisFloor = localStorage.getItem(FEED_KEY) === '1'; } catch { /* 저장소 없음 */ }
function renderFeedScope() {
  const btn = $('feedScope');
  btn.hidden = floors.size < 2;
  btn.classList.toggle('on', feedThisFloor);
  btn.setAttribute('aria-pressed', String(feedThisFloor));
  const want = feedThisFloor && floors.size > 1 ? current : null;
  if (want !== feedScope) feed.only((feedScope = want));
}
$('feedScope').addEventListener('click', () => {
  feedThisFloor = !feedThisFloor;
  try { localStorage.setItem(FEED_KEY, feedThisFloor ? '1' : '0'); } catch { /* 저장소 없음 */ }
  renderFeedScope();
});

// 활동 기록 '실패만': 실패·API 오류·중단 줄만 모아 본다. 그런 줄이 있거나 켜 둔 동안만 버튼이 보인다.
let feedFails = false;
function renderFeedFails(n = feed.failCount()) {
  const btn = $('feedFails');
  btn.hidden = !n && !feedFails;
  btn.textContent = n ? `실패만 ${n}` : '실패만';
  btn.classList.toggle('on', feedFails);
  btn.setAttribute('aria-pressed', String(feedFails));
}
$('feedFails').addEventListener('click', () => {
  feedFails = !feedFails;
  feed.failsOnly(feedFails);
  renderFeedFails();
});

// ───────────────────────── 캐릭터 정보 카드 ─────────────────────────
// 캐릭터를 누르면 옆에 뜬다. 내용은 js/card.js가 만들고, 여기서는 띄울 자리만 정한다.
let cardActor = null, cardHtml = '';
// 이어 하기 명령을 Windows(PowerShell) 꼴로 만들지
const IS_WIN = /Win/i.test(navigator.platform || navigator.userAgent || '');
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
  const html = buildCard(a, s, {
    ctx: a.intern ? null : ctxOf(s),
    live: viewMode !== 'demo' && viewMode !== 'replay' && !!s.info.file,
    pinned: viewMode === 'file',
    win: IS_WIN,
  });
  const card = $('card');
  if (html !== cardHtml) card.innerHTML = cardHtml = html;
  card.hidden = false;
  // 작은 무대에서는 다시 키우되 무대 높이는 넘지 않게
  const k = Math.min(cardK, (H - 16) / card.offsetHeight);
  card.style.setProperty('--k', k.toFixed(3));
  const w = card.offsetWidth * k, h = card.offsetHeight * k;
  // 캐릭터 오른쪽 위에 붙이되 무대 밖으로 나가지 않게
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
    if (Date.now() - s.wait.ts < 60000) tellWait(s, s.wait);
    if (floorAuto && s.floor !== current) goFloor(s.floor);
  }
  refreshBoard();
  render();
}

// 연결 표시의 초록 점: 새 일이 들어오면 한 번 두근 (1.6초에 한 번까지)
let beatTimer = 0;
function beat() {
  if (beatTimer) return;
  $('conn').classList.add('beat');
  beatTimer = setTimeout(() => { $('conn').classList.remove('beat'); beatTimer = 0; }, 1600);
}
function setConn(state, text) {
  $('conn').dataset.state = state;
  $('conn').querySelector('span').textContent = text;
  $('conn').title = state === 'off' ? '터미널에서 npx claude-office (또는 node server.js)로 다시 켜 주세요' : '';
}

// 서버가 꺼졌으면(--stop, 컴퓨터를 껐다 켬 등) 브라우저가 1.5초마다 다시 붙으려는 걸 멈추고
// 점점 뜸하게(최대 30초) 다시 해 본다. 서버를 다시 켜면 알아서 이어진다.
let retryTimer = 0, fails = 0;
function disconnect() {
  clearTimeout(retryTimer);
  if (es) { es.close(); es = null; }
}
function connect() {
  disconnect();
  const want = $('sessionSelect').value || 'all';
  viewMode = want === 'all' || want === 'auto' ? want : 'file';
  es = new EventSource('/api/stream?file=' + encodeURIComponent(want));
  if (fails < 3) setConn('wait', '연결 중…'); // 꺼져 있다고 알린 뒤로는 다시 해 보는 동안에도 그 말을 그대로 둔다
  es.onopen = () => { fails = 0; setConn('live', '실시간 · 0.25초 간격'); };
  es.onerror = () => {
    fails++;
    if (fails < 3) return setConn('off', '재연결 중…');
    disconnect();
    setConn('off', '사무실 서버가 꺼져 있어요 · 다시 켜면 이어져요');
    retryTimer = setTimeout(connect, Math.min(30000, 2000 * 2 ** (fails - 3)));
  };
  es.addEventListener('hello', e => { setConn('live', '실시간 · 0.25초 간격'); onHello(JSON.parse(e.data)); });
  es.addEventListener('join', e => onJoin(JSON.parse(e.data)));
  es.addEventListener('leave', e => retireSession(JSON.parse(e.data).sid));
  es.addEventListener('events', e => { beat(); for (const u of JSON.parse(e.data).updates || []) applyUpdate(u); });
}

// ───────────────────────── 세션 목록 ─────────────────────────
const isFile = v => v && v !== 'all' && v !== 'auto';
// 60 → 1시간, 90 → 90분
const minutesText = m => (m >= 60 && m % 60 === 0 ? `${m / 60}시간` : `${m}분`);
// keepFile: 처음 켤 때 저장해 둔 고정 세션 (그 뒤로는 지금 고른 값)
async function loadSessions(keepFile) {
  const sel = $('sessionSelect');
  const keep = keepFile || sel.value;
  let d;
  try { d = await (await fetch('/api/sessions' + (isFile(keep) ? '?keep=' + encodeURIComponent(keep) : ''))).json(); } catch { return; }
  showCodeNotice(d.code);
  const want = [
    ['all', `🏢 빌딩 · 최근 ${minutesText(d.activeMinutes || 30)} 세션 모두`],
    ['auto', '자동 · 가장 최근 세션 하나'],
    ...(d.sessions || []).map(s => [s.file, `${s.file === keep ? '📌 ' : sessions.has(s.id) ? '● ' : ''}${s.waiting ? '🔐 ' : ''}${s.limitUntil > Date.now() ? '⏳ ' : ''}${s.project} — ${clip(s.title, 34)} · ${ago(s.mtime)}`]),
  ];
  // 통째로 다시 만들지 않고 바뀐 칸만 고친다: 15초마다 새로 고쳐도 열어 둔 목록이 닫히거나 튀지 않게
  want.forEach(([value, text], i) => {
    const o = sel.options[i] || sel.appendChild(document.createElement('option'));
    if (o.value !== value) o.value = value;
    if (o.textContent !== text) o.textContent = text;
  });
  while (sel.options.length > want.length) sel.remove(want.length);
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

// 켜 둔 사이에 사무실 프로그램이 바뀌었으면(git pull 등) 다시 켜거나 새로 고치라고 알려 준다. 닫으면 다음에 또 바뀔 때까지 숨긴다
let firstUi = 0, codeShown = '', codeClosed = '';
function showCodeNotice(code) {
  if (code && !firstUi) firstUi = code.ui;
  const n = codeNotice(code, firstUi);
  const key = n.kind && `${n.kind}|${code.ui}`;
  if (key === codeShown) return;
  codeShown = key;
  $('codeBar').hidden = !n.kind || key === codeClosed;
  $('codeText').textContent = n.text;
  $('codeReload').hidden = n.kind !== 'reload';
}
$('codeReload').addEventListener('click', () => location.reload());
$('codeClose').addEventListener('click', () => { codeClosed = codeShown; $('codeBar').hidden = true; });

// ───────────────────────── 데모 ─────────────────────────
function startDemo() {
  stopDemo(false);
  replay.stop(false);
  disconnect();
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
      // { wait }·{ compacting } 항목은 hook이 알려 주는 권한 확인 대기·대화 압축 중을 흉내 낸다
      if ('wait' in ev) setWait(s, ev.wait && { ...ev.wait, ts: Date.now() });
      else if ('compacting' in ev) s.main.setCompacting(ev.compacting && { ...ev.compacting, ts: Date.now() });
      else {
        const { ctx, ...e } = ev;
        applyUpdate({ sid, events: [{ ...e, ts: Date.now() }], ...(ctx && { meta: { ctx } }) });
      }
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
// 도움말 내용은 js/help.js에 있다 (? 버튼이나 ? 키)
function buildHelp() {
  $('helpBody').innerHTML = helpHtml();
}
// 도움말 창도 열면 초점을 창 안으로, 닫으면 원래 자리로
let helpReturn = null;
function openHelp() {
  if (!$('helpBody').innerHTML) buildHelp();
  // hooks가 꺼져 있으면 권한 대기·압축 중이 안 보이니, 열 때마다 서버에 물어서 맨 위에 알려 준다
  fetch('/api/hooks').then(r => r.json()).then(h => {
    const p = $('helpHooks');
    if (!p) return;
    p.innerHTML = hooksLine(h);
    p.hidden = !p.innerHTML;
    p.classList.toggle('bad', h.state !== 'on');
  }).catch(() => {});
  helpReturn = document.activeElement;
  $('help').hidden = false;
  $('helpClose').focus();
}
function closeHelp() {
  $('help').hidden = true;
  if (helpReturn && helpReturn.isConnected) helpReturn.focus();
  helpReturn = null;
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
// 걸어가는 사람이 있을 때만 매 프레임 돈다. 다들 서 있으면 쉬면서 0.1초마다 한 번씩만 본다
// (안 움직이는데 초당 60번 도는 건 CPU 낭비라서)
let framing = false;
const moving = () => { for (const a of actors) if (a.path.length) return true; return false; };
function frame() {
  step();
  if (moving()) requestAnimationFrame(frame);
  else framing = false;
}
office.wake = () => {
  if (framing || document.hidden) return; // 가려진 탭은 아래 타이머가 진행시킨다
  framing = true;
  lastT = performance.now();
  requestAnimationFrame(frame);
};
// 탭이 가려져 rAF가 멈춰도 걸음이 멈추지 않게 타이머로도 한 번씩 진행시킨다
// 0.1초마다: 누가 걷기 시작했는데 프레임이 쉬고 있으면 깨우고, 아니면(가려진 탭 등) 직접 한 걸음
setInterval(() => {
  if (moving() && !framing && !document.hidden) office.wake();
  else if (performance.now() - lastT > 150) step();
}, 100);
setInterval(() => { for (const a of actors) if (!a.running) a.rest(); retireInterns(); tellFreed(); }, 500);

// 사용 한도가 풀리는 때가 되면 알려 준다 (활동 기록 한 줄 + 알림). 10분 넘게 지난 건 조용히 넘어간다.
function tellFreed() {
  if (viewMode === 'demo' || viewMode === 'replay') return;
  for (const s of sessions.values()) {
    const h = s.main && s.main.halt;
    if (!h || h.kind !== 'limit' || !h.resetAt || h.told || Date.now() < h.resetAt) continue;
    h.told = true;
    if (Date.now() - h.resetAt > 10 * 60 * 1000) continue;
    feed.add(s, s.main, { k: 'freed', ts: h.resetAt });
    tell(s, '✅ 사용 한도가 풀렸어요', '다시 일을 시킬 수 있어요');
  }
}
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
// 키보드로도: Tab으로 줄을 고르고 Enter
$('lobby').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  showActor(e.target.closest('[data-floor]'));
});
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
$('emptyDemo').addEventListener('click', () => startDemo());
$('card').addEventListener('click', e => {
  e.stopPropagation();
  const act = e.target.closest('[data-act]');
  const s = cardActor && sessions.get(cardActor.sid);
  if (!act || !s) return;
  if (act.dataset.act === 'close') return closeCard();
  closeCard();
  if (act.dataset.act === 'replay') replay.start(s.info.file);
  if (act.dataset.act === 'fails') {
    // 활동 기록을 '실패만'으로 바꾸고 보이는 곳으로
    if (!feedFails) $('feedFails').click();
    el.feed.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  if (act.dataset.act === 'pin') {
    sel.value = s.info.file;
    sel.dispatchEvent(new Event('change'));
  }
  if (act.dataset.act === 'resume') {
    const cmd = resumeCommand(s.info.cwd, s.sid, IS_WIN);
    copyText(cmd).then(ok => toast(ok ? '📋 복사했어요 · 터미널에 붙여 넣으면 이 세션을 이어서 해요' : `복사하지 못했어요: ${cmd}`));
  }
});

// 클립보드에 넣기. 막혀 있으면 옛 방식(숨긴 글상자 + copy)으로 한 번 더 해 본다
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* 권한 없음 */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* 안 됨 */ }
  ta.remove();
  return ok;
}
el.stage.addEventListener('click', () => closeCard()); // 빈 곳을 누르면 닫기
$('helpBtn').addEventListener('click', openHelp);
$('helpClose').addEventListener('click', closeHelp);
$('help').addEventListener('click', e => { if (e.target === e.currentTarget) closeHelp(); });
// 단축키: Space 다시 보기 멈춤·이어 보기, ←·→ 다시 보기 5%씩 이동, 1~9 그 층으로, 0 층 자동, J 업무 일지
// (J는 한글 자판(ㅓ)에서도 되게 자리(code)로도 본다)
const isJ = e => e.key === 'j' || e.key === 'J' || e.code === 'KeyJ';
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || (e.target.closest && e.target.closest('input, select, textarea'))) return;
  if (cardActor && e.key === 'Escape') return closeCard();
  if (!$('help').hidden) {
    if (e.key === 'Escape' || e.key === '?') closeHelp();
    return;
  }
  if (journal.isOpen()) {
    if (e.key === 'Escape' || isJ(e)) journal.close();
    if (e.key === 'ArrowLeft') journal.prev();
    if (e.key === 'ArrowRight') journal.next();
    if (e.key === 'w' || e.key === 'W' || e.code === 'KeyW') journal.toggleWeek();
    return;
  }
  if (e.key === '?') return openHelp();
  if (isJ(e)) return journal.open(0);
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
setInterval(() => { if ($('conn').dataset.state !== 'off') loadSessions(); }, 15000); // 서버가 꺼져 있으면 쉰다

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
