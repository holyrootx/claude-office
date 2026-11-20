// 오른쪽 활동 기록: 이벤트 하나를 한 줄로 쌓는다. 도구 줄에는 나중에 성공(✓)·실패(✗)를 붙인다.
import { esc, clip, stamp, fmtTokens, compactHow, scheduleName } from './util.js';

export { scheduleName }; // 테스트가 여기서 가져다 쓴다
import { ROOMS } from './scene.js';

const MAX_LINES = 200;

// manyPeople(): 여러 세션이 있어서 줄마다 누가 한 일인지 이름표를 붙여야 할 때 true
// only(층): 그 층에서 한 일만 보여 준다 (null이면 모든 층). 가린 줄도 지우지 않고 남겨 둔다.
// failsOnly(true): 실패·오류·중단 줄(err)만 보여 준다. onFails(n): 남아 있는 그런 줄 수가 바뀔 때
export function createFeed(list, { manyPeople, onFails = () => {} }) {
  const items = new Map();
  const known = new Map();
  let onlyFloor = null;
  let fails = 0;
  // 키보드: 활동 기록의 Tab 자리는 한 줄뿐이다(줄마다 Tab이면 200번 눌러야 지나간다). 그 안에서는 ↑ ↓로 옮긴다(app.js).
  // 활동 기록 안에 초점이 없으면 Tab 자리는 늘 맨 위의 보이는 줄 ('이 층만'·'실패만'으로 가린 줄은 Tab으로 갈 수 없어서)
  let stop = null;
  const shown = li => !li.classList.contains('away') && !(list.classList.contains('fails') && !li.classList.contains('err'));
  const focusInside = () => typeof list.contains === 'function' && typeof document !== 'undefined' && list.contains(document.activeElement);
  function setStop(li) {
    if (stop === li) return;
    if (stop) stop.tabIndex = -1;
    stop = li || null;
    if (stop) stop.tabIndex = 0;
  }
  function restop() {
    if (focusInside() && stop && stop.parentNode === list) return; // 고르고 있는 줄은 그대로
    setStop([...list.children].find(shown) || null);
  }
  function focusRow(li) {
    setStop(li);
    li.focus();
  }
  function add(s, a, ev) {
    let ic = '', cls = '', tx = '', room = '', full = '';
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
        known.set(ev.id, ev);
        if (known.size > 1500) known.delete(known.keys().next().value);
        tx = `${ev.git ? '<b class="git-mark">git</b> ' : ''}<b>${esc(ev.tool)}</b> ${esc(ev.label || '')}<span class="st"></span><small>${esc(r.name)}${ev.detail && ev.detail !== ev.label ? ' · ' + esc(ev.detail) : ''}</small>`;
        // 줄에 마우스를 올리면 실제 도구 이름 (MCP는 보여 주는 이름과 달라서, 방 바꾸기 설정에 쓸 이름을 알 수 없었다)
        if (ev.name && ev.name !== ev.tool) full = `도구 이름: ${ev.name}`;
        break;
      }
      case 'result': {
        const li = items.get(ev.id);
        if (li) li.classList.add(ev.ok ? 'ok' : 'fail');
        if (ev.ok && ev.answer) { ic = '🙋'; cls = 'user'; tx = `<b>나</b> 답변: ${esc(ev.answer)}`; break; }
        if (ev.ok) return;
        const t = known.get(ev.id);
        ic = '😰'; cls = 'err'; tx = `<b>${esc((t && t.tool) || ev.name || '도구')} 실패</b> ${esc(ev.error)}`;
        break;
      }
      case 'wait':
        ic = '🔐'; cls = 'wait';
        tx = `<b>${ev.kind === 'input' ? '입력 대기' : '권한 확인 대기'}</b> ${ev.tool ? `${esc(ev.tool)} ${esc(ev.label || '')}` : esc(ev.text || '')}`;
        break;
      case 'interrupt': ic = '✋'; cls = 'err'; tx = '사용자가 작업을 중단했어요'; break;
      case 'compact': ic = '🗜'; tx = `<b>대화 압축</b>${ev.pre && ev.post ? ` ${fmtTokens(ev.pre)} → ${fmtTokens(ev.post)} 토큰` : ''} (${compactHow(ev)})`; break;
      case 'note': // 백그라운드 작업이 끝났다는 알림, 다른 세션이 보낸 말, 예약해 둔 작업의 시작, 답이 끊겨 이어 씀, 한도가 거의 다 됨
        ic = { peer: '📨', schedule: '⏰', resume: '✂️', limitsoon: '⏳' }[ev.kind] || (ev.ok ? '🔔' : '⚠');
        cls = ev.ok ? '' : 'err';
        tx = ev.kind === 'peer' ? `<b>${esc(ev.from)}</b>에서 온 말 · ${esc(ev.text)}`
          : ev.kind === 'schedule' ? `<b>예약된 작업</b> ${esc(scheduleName(ev.text))}` : esc(ev.text);
        if (ev.kind === 'schedule') full = ev.text;
        break;
      case 'freed': ic = '✅'; cls = 'say'; tx = '<b>사용 한도가 풀렸어요</b> 다시 일을 시킬 수 있어요'; break;
      case 'closed': ic = '🚪'; tx = '<b>Claude Code를 닫았어요</b> 이어 하면 다시 일해요'; break;
      case 'leave':
        ic = '👋';
        tx = ev.why === 'ended' ? '<b>퇴근</b> Claude Code를 닫아서 빌딩을 나갔어요. 이어 하면 다시 출근해요'
          // 빌딩이 꽉 차서(기본 12명) 새 직원에게 자리를 내준 것: 오래 조용했던 건 아닐 수 있다
          : ev.why === 'full' ? `<b>퇴근</b> 빌딩이 꽉 차서${ev.max ? `(${Number(ev.max)}명)` : ''} 가장 오래 조용한 직원이 자리를 내줬어요. 다시 일하면 출근해요`
            : '<b>퇴근</b> 한동안 조용해서 빌딩을 나갔어요. 다시 일하면 출근해요';
        break;
      case 'apierr':
        if (ev.kind === 'limit') { ic = '⏳'; cls = 'wait'; tx = `<b>사용 한도</b> ${ev.resets ? `${esc(ev.resets)}에 다시 열려요` : '한도가 풀리면 다시 일해요'}`; break; }
        ic = '⚠'; cls = 'err'; tx = `<b>API 오류</b> ${esc(ev.text)}`;
        break;
      default: return;
    }
    // 여러 세션이나 인턴이 있으면 누가 한 일인지 이름표를 붙인다
    const who = a && (a.intern || manyPeople())
      ? `<span class="who" style="--wc:${s.color}">${a.intern ? '인턴 · ' : ''}${esc(a.name)}</span>`
      : '';
    const li = document.createElement('li');
    if (full) li.title = full;
    if (cls) li.className = cls;
    if (room) li.dataset.room = room;
    li.dataset.floor = s.floor;
    if (onlyFloor && s.floor !== onlyFloor) li.classList.add('away');
    if (a) li.dataset.actor = a.key;
    li.tabIndex = -1;
    // 오늘이 아닌 기록에는 날짜도 ('11/17 23:15'): 며칠째 이어지는 세션을 열면 어제 기록이 섞여 와서,
    // 시각만 보면 오늘 아침 09:00 줄 아래의 14:00 줄이 언제 것인지 알 수 없었다
    const at = ev.at || ev.ts || Date.now();
    const dated = !!(ev.atDate || new Date(at).toDateString() !== new Date().toDateString());
    li.innerHTML = `<time>${stamp(at, dated)}</time><span class="ic">${ic}</span><div class="tx">${who}${tx}</div>`;
    if (!dated) li.dataset.at = String(at); // 자정을 넘기면 날짜를 붙이려고 (redate)
    if (ev.k === 'tool') items.set(ev.id, li);
    list.prepend(li);
    const before = fails;
    if (cls === 'err') fails++;
    while (list.children.length > MAX_LINES) {
      const last = list.lastElementChild;
      for (const [k, v] of items) if (v === last) items.delete(k);
      if (last.classList.contains('err')) fails--;
      if (last === stop) stop = null;
      last.remove();
    }
    restop();
    if (fails !== before) onFails(fails);
  }
  // 화면을 켜 둔 채 자정을 넘기면 어제가 된 줄에도 날짜를 붙인다. 전에는 시각만 남아서, 아침에 보면
  // 밤 23:15 줄이 오늘 것처럼 보였다 (그 아래 오늘 줄들과 구분되지 않았다). 1분마다 불린다
  let today = new Date().toDateString();
  function redate(now = Date.now()) {
    const day = new Date(now).toDateString();
    if (day === today) return;
    today = day;
    for (const li of list.children) {
      const at = Number(li.dataset.at);
      if (!at || new Date(at).toDateString() === day) continue;
      const t = li.querySelector('time');
      if (t) t.textContent = stamp(at, true);
      delete li.dataset.at;
    }
  }
  function clear() {
    items.clear();
    known.clear();
    list.innerHTML = '';
    stop = null;
    if (fails) onFails((fails = 0));
  }
  function only(floor) {
    onlyFloor = floor || null;
    list.classList.toggle('only', !!onlyFloor);
    for (const li of list.children) li.classList.toggle('away', !!onlyFloor && li.dataset.floor !== onlyFloor);
    setStop(null);
    restop();
  }
  function failsOnly(on) {
    list.classList.toggle('fails', !!on);
    setStop(null);
    restop();
  }
  return { add, clear, only, failsOnly, redate, focusRow, failCount: () => fails };
}
