// 업무 일지: 오늘(자정 이후) Claude가 한 일을 프로젝트별로 모아 보여 준다. 세션을 누르면 처음부터 다시 본다.
import { $, esc, clip, hhmmss, fmtTokens } from './util.js';
import { ROOMS, ROOM_IDS } from './scene.js';

// toast: 짧은 안내, onPick(file): 세션을 골랐을 때 (다시 보기 시작)
export function createJournal({ toast, onPick }) {
  const fmtWorked = ms => {
    const m = Math.round(ms / 60000);
    return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
  };
  async function openJournal() {
    let j;
    try { j = await (await fetch('/api/journal')).json(); } catch { return toast('업무 일지를 읽지 못했어요'); }
    const d = new Date(j.since);
    $('journalTitle').textContent = `📓 ${d.getMonth() + 1}월 ${d.getDate()}일 업무 일지`;
    const t = j.totals;
    $('journalTotals').innerHTML = [
      ['일한 시간', fmtWorked(t.workedMs)], ['프로젝트', t.projects], ['세션', t.sessions],
      ['내 메시지', t.prompts], ['도구', t.tools], ['실패', t.errors], ['인턴', t.interns], ['출력 토큰', fmtTokens(t.tokens || 0)],
    ].map(([k, v]) => `<div><b>${esc(v)}</b><span>${k}</span></div>`).join('');
    $('journalList').innerHTML = j.projects.length ? j.projects.map(p => {
      const max = Math.max(1, ...ROOM_IDS.map(r => p.rooms[r]));
      const rooms = ROOM_IDS.map(r => `<span style="--c:var(--${r});--w:${Math.round((p.rooms[r] / max) * 100)}%" title="${ROOMS[r].name} ${p.rooms[r]}번">${ROOMS[r].icon}<i></i><b>${p.rooms[r]}</b></span>`).join('');
      const list = p.sessions.map(s => `<li data-file="${esc(s.file)}" title="누르면 처음부터 다시 봐요"><span>⏪ ${esc(clip(s.title, 44))}</span><time>${fmtWorked(s.workedMs)}</time></li>`).join('');
      return `<section class="jp"><h3>${esc(p.project)} <small>${hhmmss(p.first).slice(0, 5)} ~ ${hhmmss(p.last).slice(0, 5)} · ${fmtWorked(p.workedMs)}</small></h3>`
        + `<div class="jp-nums">메시지 ${p.prompts} · 도구 ${p.tools}${p.errors ? ` · 실패 ${p.errors}` : ''}${p.interns ? ` · 인턴 ${p.interns}명` : ''}${p.tokens ? ` · 출력 토큰 ${fmtTokens(p.tokens)}` : ''}</div>`
        + `<div class="jp-rooms">${rooms}</div><ul>${list}</ul></section>`;
    }).join('') : '<p class="jp-empty">오늘은 아직 일한 기록이 없어요</p>';
    $('journal').hidden = false;
  }
  function closeJournal() {
    $('journal').hidden = true;
  }

  $('journalBtn').addEventListener('click', openJournal);
  $('journalClose').addEventListener('click', closeJournal);
  $('journal').addEventListener('click', e => {
    if (e.target === e.currentTarget) return closeJournal(); // 바깥을 누르면 닫기
    const li = e.target.closest('li[data-file]');
    if (li) {
      closeJournal();
      onPick(li.dataset.file);
    }
  });
  return { open: openJournal, close: closeJournal, isOpen: () => !$('journal').hidden };
}
