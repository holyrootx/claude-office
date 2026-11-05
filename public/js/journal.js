// 업무 일지: 그날(0시~24시) Claude가 한 일을 프로젝트별로 모아 보여 준다. ◀ ▶로 다른 날, 세션을 누르면 처음부터 다시 본다.
// '주간'(W)을 누르면 한 주(월요일~)를 날마다·프로젝트마다 모아 본다.
import { $, esc, clip, hhmmss, fmtTokens } from './util.js';
import { ROOMS, ROOM_IDS } from './scene.js';

// toast: 짧은 안내, onPick(file): 세션을 골랐을 때 (다시 보기 시작), copy(text): 클립보드에 넣기 (되면 true)
export function createJournal({ toast, onPick, copy }) {
  const fmtWorked = ms => {
    const m = Math.round(ms / 60000);
    return m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`;
  };
  let day = 0; // 0 = 오늘, -1 = 어제 …
  let week = null; // 한 주 모아 보기면 0 = 이번 주, -1 = 지난 주 …, 하루 일지면 null
  const query = () => (week == null ? `day=${day}` : `week=${week}`);
  let asked = 0; // ◀를 빨리 여러 번 눌렀을 때 마지막 것만 그린다
  let loading = false; // 받아 오는 중 (창은 아직 안 떴지만 Esc·J로 그만둘 수 있게 열린 셈 친다)
  async function openJournal(want = 0, wantWeek = null) {
    const ask = ++asked;
    loading = true;
    // 받아 오는 사이에 ◀ ▶를 눌러도 새로 고른 날·주를 기준으로 움직이게 바로 바꿔 둔다
    day = want;
    week = wantWeek;
    const q = query();
    $('journalBox').classList.add('busy'); // 받아 오는 동안 흐리게 (한 주는 조금 더 걸린다)
    let j;
    try { j = await (await fetch('/api/journal?' + q)).json(); } catch {
      if (ask !== asked) return;
      loading = false;
      $('journalBox').classList.remove('busy');
      return toast('업무 일지를 읽지 못했어요');
    }
    if (ask !== asked) return;
    loading = false;
    $('journalBox').classList.remove('busy');
    fetch(`/api/journal?${q}&format=md`).then(r => r.text()).then(text => { if (query() === q) md = { q, text }; }, () => {});
    if (week == null) drawDay(j);
    else drawWeek(j);
    $('journalWeek').classList.toggle('on', week != null);
    $('journalWeek').setAttribute('aria-pressed', String(week != null));
    $('journalPrev').title = week == null ? '전날 (←)' : '지난 주 (←)';
    $('journalNext').title = week == null ? '다음 날 (→)' : '다음 주 (→)';
    if ($('journal').hidden) {
      // 창을 열면 키보드 초점을 창 안으로 옮기고, 닫을 때 원래 자리(📓 버튼 등)로 돌려준다
      returnFocus = document.activeElement;
      $('journal').hidden = false;
      $('journalClose').focus();
    }
  }

  const totalsHtml = list => list.map(([k, v]) => `<div><b>${esc(v)}</b><span>${k}</span></div>`).join('');
  const roomsHtml = rooms => {
    const max = Math.max(1, ...ROOM_IDS.map(r => rooms[r] || 0));
    return ROOM_IDS.map(r => `<span style="--c:var(--${r});--w:${Math.round(((rooms[r] || 0) / max) * 100)}%" title="${ROOMS[r].name} ${rooms[r] || 0}번">${ROOMS[r].icon}<i></i><b>${rooms[r] || 0}</b></span>`).join('');
  };
  const numsHtml = p => `<div class="jp-nums">메시지 ${p.prompts}${p.scheduled ? ` · 예약 작업 ${p.scheduled}` : ''} · 도구 ${p.tools}${p.errors ? ` · 실패 ${p.errors}` : ''}${p.interns ? ` · 인턴 ${p.interns}명` : ''}${p.tokens ? ` · 출력 토큰 ${fmtTokens(p.tokens)}` : ''}</div>`;
  const sessionLi = s => `<li data-file="${esc(s.file)}" tabindex="0" role="button" title="누르면 처음부터 다시 봐요"><span>⏪ ${esc(clip(s.title, 44))}</span><time>${fmtWorked(s.workedMs)}</time></li>`;

  // 하루 일지
  function drawDay(j) {
    const d = new Date(j.since);
    const rel = j.today ? '오늘' : day === -1 ? '어제' : `${-day}일 전`;
    $('journalTitle').innerHTML = `📓 ${d.getMonth() + 1}월 ${d.getDate()}일 업무 일지<small>${rel}</small>`;
    $('journalNext').disabled = j.today;
    const t = j.totals;
    $('journalTotals').innerHTML = totalsHtml([
      ['일한 시간', fmtWorked(t.workedMs)], ['프로젝트', t.projects], ['세션', t.sessions],
      ['내 메시지', t.prompts], ...(t.scheduled ? [['예약 작업', t.scheduled]] : []), ['도구', t.tools], ['실패', t.errors], ['인턴', t.interns], ['출력 토큰', fmtTokens(t.tokens || 0)],
    ]);
    // 시간대별 도구 사용: 하루 리듬을 막대 24개로 (지금 시각은 진하게)
    const hours = j.hours || [];
    const maxH = Math.max(1, ...hours);
    const nowH = j.today ? new Date().getHours() : -1;
    $('journalHours').classList.remove('week');
    $('journalHours').setAttribute('aria-label', '시간대별 도구 사용');
    $('journalHours').hidden = !hours.some(Boolean);
    $('journalHours').innerHTML = hours.map((n, h) => `<i class="${h === nowH ? 'now' : ''}" style="--h:${Math.round((n / maxH) * 100)}%" title="${h}시 · 도구 ${n}번"></i>`).join('')
      + [0, 6, 12, 18].map(h => `<span style="--c:${h + 1}">${h}시</span>`).join('');
    $('journalList').innerHTML = j.projects.length ? j.projects.map(p =>
      `<section class="jp"><h3>${esc(p.project)} <small>${hhmmss(p.first).slice(0, 5)} ~ ${hhmmss(p.last).slice(0, 5)} · ${fmtWorked(p.workedMs)}</small></h3>`
        + numsHtml(p) + `<div class="jp-rooms">${roomsHtml(p.rooms)}</div><ul>${p.sessions.map(sessionLi).join('')}</ul></section>`).join('')
      : `<p class="jp-empty">${j.today ? '오늘은 아직 일한 기록이 없어요' : '이날은 일한 기록이 없어요'}</p>`;
  }

  // 한 주 모아 보기: 날마다 일한 시간 막대, 프로젝트는 여러 날을 합쳐서 (세션은 긴 순서로 8개까지)
  const WEEKDAY = '일월화수목금토';
  function drawWeek(j) {
    const rel = j.today ? '이번 주' : week === -1 ? '지난 주' : `${-week}주 전`;
    $('journalTitle').innerHTML = `📓 ${esc(j.title)}<small>${rel}</small>`;
    $('journalNext').disabled = j.today;
    const t = j.totals;
    $('journalTotals').innerHTML = totalsHtml([
      ['일한 시간', fmtWorked(t.workedMs)], ['일한 날', `${j.worked}/${j.days.length}`], ['프로젝트', j.projects.length],
      ['내 메시지', t.prompts], ...(t.scheduled ? [['예약 작업', t.scheduled]] : []), ['도구', t.tools], ['실패', t.errors], ['출력 토큰', fmtTokens(t.tokens || 0)],
    ]);
    const maxD = Math.max(1, ...j.days.map(d => d.workedMs));
    const today = new Date().setHours(0, 0, 0, 0);
    const label = d => { const x = new Date(d.since); return `${x.getMonth() + 1}/${x.getDate()} (${WEEKDAY[x.getDay()]})`; };
    $('journalHours').classList.add('week');
    $('journalHours').setAttribute('aria-label', '날마다 일한 시간');
    $('journalHours').hidden = false;
    $('journalHours').innerHTML = j.days.map(d => `<i class="${d.since === today ? 'now' : ''}" style="--h:${Math.round((d.workedMs / maxD) * 100)}%" title="${label(d)} · ${d.workedMs ? `${fmtWorked(d.workedMs)} · 도구 ${d.tools}번` : '쉼'}"></i>`).join('')
      + j.days.map((d, i) => `<span style="--c:${i + 1}"><b>${WEEKDAY[new Date(d.since).getDay()]}</b>${d.workedMs ? fmtWorked(d.workedMs) : '·'}</span>`).join('');
    $('journalList').innerHTML = j.projects.length ? j.projects.map(p => {
      const more = p.sessions.length > 8 ? `<li class="more">그 밖에 세션 ${p.sessions.length - 8}개</li>` : '';
      return `<section class="jp"><h3>${esc(p.project)} <small>${p.days}일 · ${fmtWorked(p.workedMs)}</small></h3>`
        + numsHtml(p) + `<div class="jp-rooms">${roomsHtml(p.rooms)}</div><ul>${p.sessions.slice(0, 8).map(sessionLi).join('')}${more}</ul></section>`;
    }).join('') : `<p class="jp-empty">${j.today ? '이번 주에는 아직 일한 기록이 없어요' : '이 주에는 일한 기록이 없어요'}</p>`;
  }
  let returnFocus = null;
  function closeJournal() {
    asked++; // 아직 받는 중인 일지는 버린다 (누르자마자 Esc를 누르면 닫힌 뒤에 뜨지 않게)
    loading = false;
    $('journalBox').classList.remove('busy');
    $('journal').hidden = true;
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  const prev = () => (week == null ? openJournal(day - 1) : openJournal(0, week - 1));
  const next = () => (week == null ? day < 0 && openJournal(day + 1) : week < 0 && openJournal(0, week + 1));
  // 하루 ↔ 한 주 (W)
  const toggleWeek = () => (week == null ? openJournal(0, 0) : openJournal(0));
  // 보고 있는 날의 일지를 마크다운으로 복사 (하루 보고·스탠드업에 붙여 넣기)
  // 마크다운은 일지를 열 때 미리 받아 둔다: 누른 순간 바로 복사해야 Safari도 클립보드를 허락한다
  let md = null;
  async function copyMarkdown() {
    let text = md && md.q === query() ? md.text : null;
    if (text == null) {
      try { text = await (await fetch(`/api/journal?${query()}&format=md`)).text(); } catch { return toast('업무 일지를 읽지 못했어요'); }
    }
    toast((await copy(text)) ? '📋 일지를 마크다운으로 복사했어요' : '복사하지 못했어요');
  }
  $('journalBtn').addEventListener('click', () => openJournal(0));
  $('journalCopy').addEventListener('click', copyMarkdown);
  $('journalWeek').addEventListener('click', toggleWeek);
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
  return { open: openJournal, close: closeJournal, prev, next, toggleWeek, isOpen: () => !$('journal').hidden || loading };
}
