// 오른쪽 활동 기록: 이벤트 하나를 한 줄로 쌓는다. 도구 줄에는 나중에 성공(✓)·실패(✗)를 붙인다.
import { esc, clip, stamp, fmtTokens } from './util.js';
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
  function add(s, a, ev) {
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
        known.set(ev.id, ev);
        if (known.size > 1500) known.delete(known.keys().next().value);
        tx = `${ev.git ? '<b style="color:#f05033">git</b> ' : ''}<b>${esc(ev.tool)}</b> ${esc(ev.label || '')}<span class="st"></span><small>${esc(r.name)}${ev.detail && ev.detail !== ev.label ? ' · ' + esc(ev.detail) : ''}</small>`;
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
      case 'compact': ic = '🗜'; tx = `<b>대화 압축</b>${ev.pre && ev.post ? ` ${fmtTokens(ev.pre)} → ${fmtTokens(ev.post)} 토큰${ev.trigger === 'manual' ? ' (내가 요청)' : ' (자동)'}` : ''}`; break;
      case 'note': // 백그라운드 작업이 끝났다는 알림, 다른 세션이 보낸 말
        ic = ev.kind === 'peer' ? '📨' : ev.ok ? '🔔' : '⚠';
        cls = ev.ok ? '' : 'err';
        tx = ev.kind === 'peer' ? `<b>${esc(ev.from)}</b>에서 온 말 · ${esc(ev.text)}` : esc(ev.text);
        break;
      case 'freed': ic = '✅'; cls = 'say'; tx = '<b>사용 한도가 풀렸어요</b> 다시 일을 시킬 수 있어요'; break;
      case 'leave': ic = '👋'; tx = '<b>퇴근</b> 한동안 조용해서 빌딩을 나갔어요. 다시 일하면 출근해요'; break;
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
    if (cls) li.className = cls;
    if (room) li.dataset.room = room;
    li.dataset.floor = s.floor;
    if (onlyFloor && s.floor !== onlyFloor) li.classList.add('away');
    if (a) li.dataset.actor = a.key;
    li.innerHTML = `<time>${stamp(ev.at || ev.ts || Date.now(), ev.atDate)}</time><span class="ic">${ic}</span><div class="tx">${who}${tx}</div>`;
    if (ev.k === 'tool') items.set(ev.id, li);
    list.prepend(li);
    const before = fails;
    if (cls === 'err') fails++;
    while (list.children.length > MAX_LINES) {
      const last = list.lastElementChild;
      for (const [k, v] of items) if (v === last) items.delete(k);
      if (last.classList.contains('err')) fails--;
      last.remove();
    }
    if (fails !== before) onFails(fails);
  }
  function clear() {
    items.clear();
    known.clear();
    list.innerHTML = '';
    if (fails) onFails((fails = 0));
  }
  function only(floor) {
    onlyFloor = floor || null;
    list.classList.toggle('only', !!onlyFloor);
    for (const li of list.children) li.classList.toggle('away', !!onlyFloor && li.dataset.floor !== onlyFloor);
  }
  function failsOnly(on) {
    list.classList.toggle('fails', !!on);
  }
  return { add, clear, only, failsOnly, failCount: () => fails };
}
