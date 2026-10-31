// 오른쪽 활동 기록: 이벤트 하나를 한 줄로 쌓는다. 도구 줄에는 나중에 성공(✓)·실패(✗)를 붙인다.
import { esc, clip, hhmmss } from './util.js';
import { ROOMS } from './scene.js';

const MAX_LINES = 200;

// manyPeople(): 여러 세션이 있어서 줄마다 누가 한 일인지 이름표를 붙여야 할 때 true
export function createFeed(list, { manyPeople }) {
  const items = new Map();
  const known = new Map();
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
      case 'compact': ic = '🗜'; tx = '대화 압축(요약)'; break;
      case 'leave': ic = '👋'; tx = '<b>퇴근</b> 한동안 조용해서 빌딩을 나갔어요. 다시 일하면 출근해요'; break;
      case 'apierr': ic = '⚠'; cls = 'err'; tx = `<b>API 오류</b> ${esc(ev.text)}`; break;
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
    li.innerHTML = `<time>${hhmmss(ev.at || ev.ts || Date.now())}</time><span class="ic">${ic}</span><div class="tx">${who}${tx}</div>`;
    if (ev.k === 'tool') items.set(ev.id, li);
    list.prepend(li);
    while (list.children.length > MAX_LINES) {
      const last = list.lastElementChild;
      for (const [k, v] of items) if (v === last) items.delete(k);
      last.remove();
    }
  }
  function clear() {
    items.clear();
    known.clear();
    list.innerHTML = '';
  }
  return { add, clear };
}
