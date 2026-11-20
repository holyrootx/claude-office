// 업무 일지: 그날(0시~24시) Claude가 한 일을 프로젝트별로 모아 보여 준다. ◀ ▶로 다른 날, 세션을 누르면 그날부터 다시 본다.
// '주간'(W)을 누르면 한 주(월요일~)를 날마다, '월간'(M)을 누르면 한 달을 주마다 모아 본다. 막대를 누르면 그 주·그날로.
import { $, calendarGap } from './util.js';
import { dayView, weekView, monthView } from './journal-view.js';

// toast: 짧은 안내, onPick(file, since): 세션을 골랐을 때 (보고 있던 날·주·달의 처음부터 다시 보기), copy(text): 클립보드에 넣기 (되면 true)
// now: 지금 시각 (테스트에서 자정을 넘겨 보려고)
export function createJournal({ toast, onPick, copy, now = () => Date.now() }) {
  let day = 0; // 0 = 오늘, -1 = 어제 …
  let week = null; // 한 주 모아 보기면 0 = 이번 주, -1 = 지난 주 …, 하루 일지면 null
  let month = null; // 한 달 모아 보기면 0 = 이번 달, -1 = 지난 달 …
  let lastWeek = 0; // 마지막으로 본 주 (요일 막대를 눌러 하루로 갔다가 '주간'을 누르면 그 주로 돌아간다)
  let lastMonth = 0; // 마지막으로 본 달 (같은 식으로 '월간'을 누르면 그 달로)
  let project = ''; // '이 프로젝트만'으로 고른 프로젝트 ('' = 전부)
  let projectCwd = ''; // 그 프로젝트의 폴더 (이름이 같은 다른 폴더의 프로젝트와 섞지 않게)
  let viewSince = 0; // 보고 있는 날·주·달의 처음 (세션을 누르면 여기부터 다시 본다)
  // day·week·month·lastWeek·lastMonth는 '오늘에서 떨어진 수'라서, 그 '오늘'이 언제였는지 들고 있다가
  // 자정을 넘긴 뒤 ◀ ▶·주간·월간을 누르면 그만큼 옮긴다 (전에는 열어 둔 채 날이 바뀌면 ◀가 보던 날을 또 보여 주고 ▶는 하루를 건너뛰었다)
  let anchorAt = now();
  let paintedAt = now(); // 창에 그린 막대(data-day·data-week)가 기준으로 삼은 때
  function reanchor() {
    const g = calendarGap(anchorAt, now());
    anchorAt = now();
    if (!g.days) return;
    day -= g.days;
    if (week != null) week -= g.weeks;
    if (month != null) month -= g.months;
    lastWeek -= g.weeks;
    lastMonth -= g.months;
  }
  // 화면에서 고른 프로젝트는 '이 프로젝트만' 버튼으로 고른 것이라 이름이 꼭 같은 것만 (exact)
  const query = () => (month != null ? `month=${month}` : week != null ? `week=${week}` : `day=${day}`)
    + (project ? `&project=${encodeURIComponent(project)}&exact=1` : '') + (project && projectCwd ? `&cwd=${encodeURIComponent(projectCwd)}` : '');
  let asked = 0; // ◀를 빨리 여러 번 눌렀을 때 마지막 것만 그린다
  let loading = false; // 받아 오는 중 (창은 아직 안 떴지만 Esc·J로 그만둘 수 있게 열린 셈 친다)
  async function openJournal(want = 0, wantWeek = null, wantMonth = null) {
    const ask = ++asked;
    loading = true;
    anchorAt = now(); // 고른 날·주·달은 지금의 '오늘'에서 센 것
    // 받아 오는 사이에 ◀ ▶를 눌러도 새로 고른 날·주·달을 기준으로 움직이게 바로 바꿔 둔다
    day = want;
    week = wantMonth == null ? wantWeek : null;
    month = wantMonth;
    const q = query();
    $('journalBox').classList.add('busy'); // 받아 오는 동안 흐리게 (한 주는 조금 더 걸린다)
    let j;
    let why = '';
    try {
      const r = await fetch('/api/journal?' + q);
      j = await r.json();
      if (!r.ok) why = j.error || '업무 일지를 읽지 못했어요';
    } catch { why = '업무 일지를 읽지 못했어요'; }
    if (why) {
      if (ask !== asked) return;
      loading = false;
      $('journalBox').classList.remove('busy');
      return toast(why);
    }
    if (ask !== asked) return;
    loading = false;
    loadedAt = now();
    loadedDay = new Date(now()).toDateString();
    $('journalBox').classList.remove('busy');
    // 📋 복사할 마크다운은 일지와 같이 온다 (누른 순간 바로 복사해야 Safari도 클립보드를 허락한다)
    md = typeof j.md === 'string' ? { q, text: j.md } : null;
    if (month != null) {
      lastMonth = month;
      drawMonth(j);
    } else if (week != null) {
      lastWeek = week;
      drawWeek(j);
    } else drawDay(j);
    for (const [id, on] of [['journalWeek', week != null], ['journalMonth', month != null]]) {
      $(id).classList.toggle('on', on);
      $(id).setAttribute('aria-pressed', String(on));
    }
    const unit = month != null ? '달' : week != null ? '주' : '날';
    // 화면 읽기 프로그램이 읽는 이름(aria-label)도 같이: 월간 보기에서 ◀를 '전날'이라고 읽지 않게
    const prevName = unit === '날' ? '전날' : `지난 ${unit}`;
    $('journalPrev').title = `${prevName} (←)`;
    $('journalPrev').setAttribute('aria-label', prevName);
    $('journalNext').title = `다음 ${unit} (→)`;
    $('journalNext').setAttribute('aria-label', `다음 ${unit}`);
    if ($('journal').hidden) {
      // 창을 열면 키보드 초점을 창 안으로 옮기고, 닫을 때 원래 자리(📓 버튼 등)로 돌려준다
      returnFocus = document.activeElement;
      $('journal').hidden = false;
      $('journalClose').focus();
    }
  }

  // 창 그리기: 글자(HTML)는 journal-view.js가 만들고 여기서는 넣기만 한다
  function paint(v) {
    paintedAt = now();
    viewSince = v.since;
    $('journalTitle').innerHTML = v.title;
    $('journalNext').disabled = v.nextDisabled;
    $('journalTotals').innerHTML = v.totals;
    const hrs = $('journalHours');
    hrs.classList.toggle('week', v.hours.week);
    if (v.hours.week) hrs.style.setProperty('--n', v.hours.n);
    else hrs.style.removeProperty('--n');
    hrs.setAttribute('aria-label', v.hours.label);
    hrs.hidden = v.hours.hidden;
    hrs.innerHTML = v.hours.html;
    $('journalList').innerHTML = v.list;
  }
  const drawDay = j => paint(dayView(j, { day, project, now: now() }));
  const drawWeek = j => paint(weekView(j, { week, project, now: now() }));
  const drawMonth = j => paint(monthView(j, { month, project, now: now() }));

  // 열어 둔 창은 연 순간의 일지다. '오늘'(이번 주·이번 달)을 보는 중에 날이 바뀌면 어제 일지가 '오늘'로 남고,
  // 한참 다른 일을 하다 돌아와도 그사이 한 일이 안 보였다. 날이 바뀌었거나, 10분 넘게 지나 탭으로 돌아왔을 때만
  // 다시 받는다 (1분마다 새로 그리면 읽던 목록·펼친 '더 보기'가 자꾸 처음으로 돌아간다)
  let loadedAt = 0, loadedDay = '';
  function refreshIfStale(back = false) {
    if ($('journal').hidden || loading) return;
    const showsToday = month != null ? month === 0 : week != null ? week === 0 : day === 0;
    const dayChanged = new Date(now()).toDateString() !== loadedDay;
    if (dayChanged) loadedDay = new Date(now()).toDateString(); // 못 받아 와도 날이 바뀐 걸로는 한 번만 다시 받는다 (1분마다 '읽지 못했어요'가 뜨지 않게)
    if (!showsToday) {
      // 지난날을 보는 중에 날이 바뀌면 같은 날을 다시 그린다 ('어제'가 '2일 전'으로, 막대가 가리키는 날도 새로)
      if (dayChanged) {
        reanchor();
        openJournal(day, week, month);
      }
      return;
    }
    if (dayChanged || (back && now() - loadedAt > 10 * 60000)) openJournal(0, week != null ? 0 : null, month != null ? 0 : null);
  }
  setInterval(() => refreshIfStale(false), 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshIfStale(true); });

  let returnFocus = null;
  function closeJournal() {
    asked++; // 아직 받는 중인 일지는 버린다 (누르자마자 Esc를 누르면 닫힌 뒤에 뜨지 않게)
    loading = false;
    $('journalBox').classList.remove('busy');
    $('journal').hidden = true;
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  const prev = () => (reanchor(), month != null ? openJournal(0, null, month - 1) : week != null ? openJournal(0, week - 1) : openJournal(day - 1));
  const next = () => (reanchor(), month != null ? month < 0 && openJournal(0, null, month + 1)
    : week != null ? week < 0 && openJournal(0, week + 1) : day < 0 && openJournal(day + 1));
  // 하루 ↔ 한 주 (W), 하루 ↔ 한 달 (M)
  const toggleWeek = () => (reanchor(), week == null ? openJournal(0, lastWeek) : openJournal(0));
  const toggleMonth = () => (reanchor(), month == null ? openJournal(0, null, lastMonth) : openJournal(0));
  // 막대가 가리키는 날·주 (그린 뒤로 날이 바뀌었으면 그만큼 옮겨서)
  const barDay = el => Number(el.dataset.day) - calendarGap(paintedAt, now()).days;
  const barWeek = el => Number(el.dataset.week) - calendarGap(paintedAt, now()).weeks;
  // 보고 있는 날의 일지를 마크다운으로 복사 (하루 보고·스탠드업에 붙여 넣기)
  // 마크다운은 일지를 열 때 미리 받아 둔다: 누른 순간 바로 복사해야 Safari도 클립보드를 허락한다
  let md = null;
  async function copyMarkdown() {
    reanchor();
    let text = md && md.q === query() ? md.text : null;
    if (text == null) {
      try {
        const r = await fetch(`/api/journal?${query()}&format=md`);
        text = await r.text();
        if (!r.ok) return toast(text || '업무 일지를 읽지 못했어요'); // 안내 글을 복사하지 않게
      } catch { return toast('업무 일지를 읽지 못했어요'); }
    }
    toast((await copy(text)) ? '📋 일지를 마크다운으로 복사했어요' : '복사하지 못했어요');
  }
  // 📓·J로 새로 열면 오늘부터 (주간·월간도 이번 주·이번 달부터)
  const openFresh = (d = 0) => {
    lastWeek = 0;
    lastMonth = 0;
    project = '';
    projectCwd = '';
    return openJournal(d);
  };
  $('journalBtn').addEventListener('click', () => openFresh(0));
  $('journalCopy').addEventListener('click', copyMarkdown);
  $('journalWeek').addEventListener('click', toggleWeek);
  $('journalMonth').addEventListener('click', toggleMonth);
  $('journalPrev').addEventListener('click', prev);
  $('journalNext').addEventListener('click', next);
  $('journalClose').addEventListener('click', closeJournal);
  const pick = li => {
    closeJournal();
    onPick(li.dataset.file, viewSince);
  };
  $('journal').addEventListener('click', e => {
    if (e.target === e.currentTarget) return closeJournal(); // 바깥을 누르면 닫기
    const li = e.target.closest('li[data-file]');
    if (li) return pick(li);
    // 주간·월간의 '그 밖에 세션 N개 더 보기': 숨겨 둔 세션을 펼치고, 키보드로 눌렀으면 펼친 첫 줄로
    const more = e.target.closest('.jp-more');
    if (more) {
      const hidden = [...more.closest('ul').querySelectorAll('li[data-file][hidden]')];
      for (const h of hidden) h.hidden = false;
      more.closest('li').remove();
      if (hidden[0] && e.detail === 0) hidden[0].focus();
      return;
    }
    // '이 프로젝트만' / '✕ blog만': 보고 있던 날·주·달 그대로 다시 받아 온다
    const only = e.target.closest('.jp-only');
    const clear = e.target.closest('.jp-clear');
    if (only || clear) {
      project = only ? only.dataset.project : '';
      projectCwd = only ? only.dataset.cwd || '' : '';
      reanchor();
      return openJournal(day, week, month);
    }
    const dd = week != null && e.target.closest('[data-day]');
    if (dd) return openJournal(barDay(dd));
    const ww = month != null && e.target.closest('[data-week]');
    if (ww) openJournal(0, barWeek(ww));
  });
  // 키보드로 세션 줄을 고르고 Enter·Space로 다시 보기 (주간의 요일은 그날 일지로)
  $('journal').addEventListener('keydown', e => {
    if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.closest) return;
    const li = e.target.closest('li[data-file]');
    const dd = !li && week != null && e.target.closest('[data-day]');
    const ww = !li && month != null && e.target.closest('[data-week]');
    if (!li && !dd && !ww) return;
    e.preventDefault();
    if (li) pick(li);
    else if (dd) openJournal(barDay(dd));
    else openJournal(0, barWeek(ww));
  });
  return { open: openFresh, close: closeJournal, prev, next, toggleWeek, toggleMonth, isOpen: () => !$('journal').hidden || loading };
}
