// 다시 보기: 지난 세션을 처음부터 빠르게 다시 틀어 준다. 오래 쉬던 시간은 15초까지로 줄이고,
// 캐릭터 연출이 밀리면 기다려 준다. 진행 막대를 누르면 그 시점의 사무실로 건너뛴다.
import { $, clip, stamp } from './util.js';

const SPEEDS = [5, 10, 30];
// 빠르기마다 캐릭터에게 미리 쌓아 둘 장면 수: 많이 쌓일수록 캐릭터가 빨리 감는다
const QUEUE = { 5: 1, 10: 3, 30: 12 };

// office: 화면 쪽에서 빌려 쓰는 것들
//   pickFile() 다시 볼 세션 파일, beforeStart() 데모·실시간 연결 끄기, hello(d) 사무실 다시 세우기,
//   update(u) 이벤트 넣기, busy(sid) 그 세션 캐릭터에게 밀린 장면 수, setConn(state, text), toast(text),
//   emptyStats(), countLocal(s, ev), reconnect() 실시간으로 돌아가기
export function createReplay(office) {
  let r = null;

  async function start(fileArg) {
    // 직접 준 세션(업무 일지·정보 카드), 아니면 보기 메뉴에서 고른 세션이나 지금 보는 직원의 세션
    const file = fileArg || office.pickFile();
    if (!file) return office.toast('다시 볼 세션을 보기 메뉴에서 골라 주세요');
    let d;
    try { d = await (await fetch('/api/replay?file=' + encodeURIComponent(file))).json(); } catch { d = null; }
    if (!d || !d.events || !d.events.length) return office.toast('다시 볼 기록이 없어요');
    stop(false);
    office.beforeStart();
    office.hello({ mode: 'replay', root: '', sessions: [{ sid: d.sid, session: d.session, history: [], plan: null, stats: office.emptyStats(), wait: null, agents: [] }] });
    const day = ts => new Date(ts).toDateString();
    // 하루를 넘기는 세션이면 시각마다 날짜를 붙인다
    const multiDay = day(d.events[0].ts) !== day(d.events[d.events.length - 1].ts);
    r = { sid: d.sid, session: d.session, events: d.events, i: 0, speed: 10, timer: 0, multiDay };
    renderBtns();
    office.toast(`⏪ ${clip(d.session.title || d.session.project, 24)} 처음부터 다시 보기`);
    step();
  }

  function step() {
    if (!r || r.paused) return;
    if (r.i >= r.events.length) {
      office.setConn('demo', '다시 보기 끝 · 잠시 뒤 실시간으로');
      r.timer = setTimeout(() => stop(true), 9000);
      return;
    }
    // 캐릭터가 앞 장면을 아직 연출하는 중이면 조금 기다린다
    if (office.busy(r.sid) > QUEUE[r.speed]) {
      r.timer = setTimeout(step, 120);
      return;
    }
    const ev = r.events[r.i++];
    // 캐릭터는 지금 일어난 일처럼 움직이고, 활동 기록에는 원래 시각(at)을 적는다
    office.update({ sid: r.sid, events: [{ ...ev, at: ev.ts, atDate: r.multiDay, ts: Date.now() }] });
    office.setConn('demo', `다시 보기 ${Math.round((r.i / r.events.length) * 100)}% · ${stamp(ev.ts, r.multiDay)}`);
    renderBar();
    const next = r.events[r.i];
    const gap = next ? Math.min(Math.max(next.ts - ev.ts, 0), 15000) / r.speed : 0;
    r.timer = setTimeout(step, gap);
  }

  // 그때까지의 기록으로 사무실을 다시 세우고 거기서부터 이어 간다
  function seek(frac) {
    if (!r || !Number.isFinite(frac)) return;
    const idx = Math.max(0, Math.min(r.events.length - 1, Math.round(frac * r.events.length)));
    clearTimeout(r.timer);
    const done = r.events.slice(0, idx);
    // 원래 시간 간격은 그대로 두고, 마지막 일이 '지금' 일어난 것처럼 시각을 옮긴다 (오래된 일로 보고 정리해 버리지 않게)
    const shift = done.length ? Date.now() - done[done.length - 1].ts : 0;
    const moved = done.map(e => ({ ...e, at: e.ts, atDate: r.multiDay, ts: e.ts + shift }));
    const byAgent = new Map();
    for (const e of moved) if (e.agent) (byAgent.get(e.agent) || byAgent.set(e.agent, []).get(e.agent)).push(e);
    const agents = [];
    for (const [id, list] of byAgent) {
      const last = list[list.length - 1];
      if (last.k === 'say' && last.final) continue; // 그 시점엔 이미 퇴근한 인턴
      const intro = list.find(e => e.k === 'agent') || {};
      agents.push({ id, type: intro.type || '', desc: intro.desc || '', history: list });
    }
    const main = moved.filter(e => !e.agent);
    const stats = office.emptyStats();
    for (const e of moved) office.countLocal({ stats }, e);
    const planEv = [...main].reverse().find(e => e.k === 'tool' && e.plan);
    office.hello({ mode: 'replay', root: '', sessions: [{ sid: r.sid, session: r.session, history: main, plan: planEv ? planEv.plan : null, stats, wait: null, agents }] });
    r.i = idx;
    office.toast(`⏩ ${Math.round(frac * 100)}% 지점부터 · ${stamp(r.events[idx].ts, r.multiDay)}`);
    renderBar();
    step();
  }

  // 멈췄다가 이어 보기 (Space)
  function togglePause() {
    if (!r) return;
    r.paused = !r.paused;
    clearTimeout(r.timer);
    if (r.paused) office.setConn('demo', `다시 보기 멈춤 · ${Math.round((r.i / r.events.length) * 100)}%`);
    else step();
    renderBtns();
  }

  function stop(reconnect) {
    if (!r) return;
    clearTimeout(r.timer);
    r = null;
    renderBtns();
    if (reconnect) office.reconnect();
  }

  function cycleSpeed() {
    if (!r) return;
    r.speed = SPEEDS[(SPEEDS.indexOf(r.speed) + 1) % SPEEDS.length];
    renderBtns();
  }

  function renderBar() {
    const bar = $('replayBar');
    bar.hidden = !r;
    if (!r) return;
    const at = r.events[Math.min(r.i, r.events.length - 1)];
    bar.style.setProperty('--p', ((r.i / r.events.length) * 100).toFixed(1) + '%');
    const t = ts => stamp(ts, r.multiDay);
    bar.querySelector('span').textContent = `${t(r.events[0].ts)} — ${t(at.ts)} — ${t(r.events[r.events.length - 1].ts)} · 누르면 그 지점으로 가요`;
  }

  function renderBtns() {
    $('replayBtn').textContent = r ? '⏹' : '⏪';
    $('replayBtn').title = r ? '다시 보기 끝내고 실시간으로 돌아가기' : '고른 세션(없으면 지금 보는 직원)을 처음부터 빠르게 다시 보기';
    $('replayBtn').classList.toggle('on', !!r);
    $('speedBtn').hidden = $('pauseBtn').hidden = !r;
    if (r) {
      $('speedBtn').textContent = r.speed + '×';
      $('pauseBtn').textContent = r.paused ? '▶' : '⏸';
      $('pauseBtn').title = r.paused ? '이어 보기 (Space)' : '멈추기 (Space)';
    }
    renderBar();
  }

  $('replayBtn').addEventListener('click', () => (r ? stop(true) : start()));
  $('replayBar').addEventListener('click', e => {
    const box = e.currentTarget.getBoundingClientRect();
    seek((e.clientX - box.left) / box.width);
  });
  $('pauseBtn').addEventListener('click', togglePause);
  $('speedBtn').addEventListener('click', cycleSpeed);

  return {
    start, stop, togglePause,
    seekBy: delta => r && seek(r.i / r.events.length + delta),
    isOn: () => !!r,
  };
}
