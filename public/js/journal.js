// 업무 일지: 그날(0시~24시) Claude가 한 일을 프로젝트별로 모아 보여 준다. ◀ ▶로 다른 날, 세션을 누르면 처음부터 다시 본다.
import { $, esc, clip, hhmmss, fmtTokens } from './util.js';
import { ROOMS, ROOM_IDS } from './scene.js';

// toast: 짧은 안내, onPick(file): 세션을 골랐을 때 (다시 보기 시작), copy(text): 클립보드에 넣기 (되면 true)
export function createJournal({ toast, onPick, copy }) {
  const fmtWorked = ms => {
    const m = Math.round(ms / 60000);
    return m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`;
  };
  let day = 0; // 0 = 오늘, -1 = 어제 …
  let asked = 0; // ◀를 빨리 여러 번 눌렀을 때 마지막 것만 그린다
  let loading = false; // 받아 오는 중 (창은 아직 안 떴지만 Esc·J로 그만둘 수 있게 열린 셈 친다)
  async function openJournal(want = 0) {
    const ask = ++asked;
    loading = true;
    let j;
    try { j = await (await fetch('/api/journal?day=' + want)).json(); } catch {
      if (ask !== asked) return;
      loading = false;
      return toast('업무 일지를 읽지 못했어요');
    }
    if (ask !== asked) return;
    loading = false;
    day = want;
    fetch(`/api/journal?day=${want}&format=md`).then(r => r.text()).then(text => { if (day === want) md = { day: want, text }; }, () => {});
    const d = new Date(j.since);
    const rel = j.today ? '오늘' : day === -1 ? '어제' : `${-day}일 전`;
    $('journalTitle').innerHTML = `📓 ${d.getMonth() + 1}월 ${d.getDate()}일 업무 일지<small>${rel}</small>`;
    $('journalNext').disabled = j.today;
    const t = j.totals;
    $('journalTotals').innerHTML = [
      ['일한 시간', fmtWorked(t.workedMs)], ['프로젝트', t.projects], ['세션', t.sessions],
      ['내 메시지', t.prompts], ...(t.scheduled ? [['예약 작업', t.scheduled]] : []), ['도구', t.tools], ['실패', t.errors], ['인턴', t.interns], ['출력 토큰', fmtTokens(t.tokens || 0)],
    ].map(([k, v]) => `<div><b>${esc(v)}</b><span>${k}</span></div>`).join('');
    // 시간대별 도구 사용: 하루 리듬을 막대 24개로 (지금 시각은 진하게)
    const hours = j.hours || [];
    const maxH = Math.max(1, ...hours);
    const nowH = j.today ? new Date().getHours() : -1;
    $('journalHours').hidden = !hours.some(Boolean);
    $('journalHours').innerHTML = hours.map((n, h) => `<i class="${h === nowH ? 'now' : ''}" style="--h:${Math.round((n / maxH) * 100)}%" title="${h}시 · 도구 ${n}번"></i>`).join('')
      + [0, 6, 12, 18].map(h => `<span style="--c:${h + 1}">${h}시</span>`).join('');
    $('journalList').innerHTML = j.projects.length ? j.projects.map(p => {
      const max = Math.max(1, ...ROOM_IDS.map(r => p.rooms[r]));
      const rooms = ROOM_IDS.map(r => `<span style="--c:var(--${r});--w:${Math.round((p.rooms[r] / max) * 100)}%" title="${ROOMS[r].name} ${p.rooms[r]}번">${ROOMS[r].icon}<i></i><b>${p.rooms[r]}</b></span>`).join('');
      const list = p.sessions.map(s => `<li data-file="${esc(s.file)}" tabindex="0" role="button" title="누르면 처음부터 다시 봐요"><span>⏪ ${esc(clip(s.title, 44))}</span><time>${fmtWorked(s.workedMs)}</time></li>`).join('');
      return `<section class="jp"><h3>${esc(p.project)} <small>${hhmmss(p.first).slice(0, 5)} ~ ${hhmmss(p.last).slice(0, 5)} · ${fmtWorked(p.workedMs)}</small></h3>`
        + `<div class="jp-nums">메시지 ${p.prompts}${p.scheduled ? ` · 예약 작업 ${p.scheduled}` : ''} · 도구 ${p.tools}${p.errors ? ` · 실패 ${p.errors}` : ''}${p.interns ? ` · 인턴 ${p.interns}명` : ''}${p.tokens ? ` · 출력 토큰 ${fmtTokens(p.tokens)}` : ''}</div>`
        + `<div class="jp-rooms">${rooms}</div><ul>${list}</ul></section>`;
    }).join('') : `<p class="jp-empty">${j.today ? '오늘은 아직 일한 기록이 없어요' : '이날은 일한 기록이 없어요'}</p>`;
    if ($('journal').hidden) {
      // 창을 열면 키보드 초점을 창 안으로 옮기고, 닫을 때 원래 자리(📓 버튼 등)로 돌려준다
      returnFocus = document.activeElement;
      $('journal').hidden = false;
      $('journalClose').focus();
    }
  }
  let returnFocus = null;
  function closeJournal() {
    asked++; // 아직 받는 중인 일지는 버린다 (누르자마자 Esc를 누르면 닫힌 뒤에 뜨지 않게)
    loading = false;
    $('journal').hidden = true;
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  const prev = () => openJournal(day - 1);
  const next = () => day < 0 && openJournal(day + 1);
  // 보고 있는 날의 일지를 마크다운으로 복사 (하루 보고·스탠드업에 붙여 넣기)
  // 마크다운은 일지를 열 때 미리 받아 둔다: 누른 순간 바로 복사해야 Safari도 클립보드를 허락한다
  let md = null;
  async function copyMarkdown() {
    let text = md && md.day === day ? md.text : null;
    if (text == null) {
      try { text = await (await fetch(`/api/journal?day=${day}&format=md`)).text(); } catch { return toast('업무 일지를 읽지 못했어요'); }
    }
    toast((await copy(text)) ? '📋 일지를 마크다운으로 복사했어요' : '복사하지 못했어요');
  }
  $('journalBtn').addEventListener('click', () => openJournal(0));
  $('journalCopy').addEventListener('click', copyMarkdown);
  $('journalPrev').addEventListener('click', prev);
  $('journalNext').addEventListener('click', next);
  $('journalClose').addEventListener('click', closeJournal);
  const pick = li => {
    closeJournal();
    onPick(li.dataset.file);
  };
  $('journal').addEventListener('click', e => {
    if (e.target === e.currentTarget) return closeJournal(); // 바깥을 누르면 닫기
    const li = e.target.closest('li[data-file]');
    if (li) pick(li);
  });
  // 키보드로 세션 줄을 고르고 Enter·Space로 다시 보기
  $('journal').addEventListener('keydown', e => {
    const li = (e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('li[data-file]');
    if (!li) return;
    e.preventDefault();
    pick(li);
  });
  return { open: openJournal, close: closeJournal, prev, next, isOpen: () => !$('journal').hidden || loading };
}
