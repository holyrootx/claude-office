// 업무 일지 창의 글자(HTML): 하루·한 주·한 달, 프로젝트 고르기 버튼, 막대가 가리키는 날·주
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

let dayView, weekView, monthView;
test.before(async () => {
  ({ dayView, weekView, monthView } = await import('../public/js/journal-view.js'));
});

const at = (m, d, h = 0) => new Date(2026, m - 1, d, h).getTime();
const rooms = { library: 3, dev: 1, server: 0, search: 0, meeting: 0, desk: 0 };
const proj = (name, extra = {}) => ({ project: name, workedMs: 60 * 60000, prompts: 2, tools: 4, errors: 0, interns: 0, tokens: 0, rooms, first: at(11, 15, 9), last: at(11, 15, 10), days: 2, sessions: [{ file: `/p/${name}.jsonl`, title: `${name} 일`, workedMs: 60 * 60000 }], ...extra });
const NOW = at(11, 15, 14); // 일요일 오후 2시

test('하루: 제목·오늘 시간 진하게·예약 작업 칸은 있을 때만·프로젝트가 둘이면 고르기 버튼', () => {
  const hours = Array(24).fill(0); hours[9] = 3; hours[14] = 1;
  const j = { since: at(11, 15), today: true, hours, totals: { workedMs: 3600000, projects: 2, sessions: 2, prompts: 4, tools: 8, errors: 0, interns: 0, tokens: 0 }, projects: [proj('blog'), proj('shop')] };
  const v = dayView(j, { day: 0, now: NOW });
  assert.match(v.title, /^📓 11월 15일 업무 일지<small>오늘<\/small>$/);
  // 올해가 아닌 날은 연도도 (◀로 한참 거슬러 간 날)
  assert.match(dayView({ ...j, today: false, since: new Date(2025, 11, 25).getTime() }, { day: -325, now: NOW }).title, /^📓 2025년 12월 25일 업무 일지<small>325일 전<\/small>/);
  assert.equal(v.nextDisabled, true);
  assert.equal(v.since, at(11, 15));
  assert.ok(!v.totals.includes('예약 작업'));
  assert.ok(dayView({ ...j, totals: { ...j.totals, scheduled: 3 } }, { now: NOW }).totals.includes('<b>3</b><span>예약 작업</span>'));
  assert.equal((v.hours.html.match(/<i /g) || []).length, 24);
  assert.match(v.hours.html, /<i class="now" style="--h:33%" title="14시 · 도구 1번">/);
  assert.equal((v.list.match(/class="jp-only"/g) || []).length, 2);
  assert.match(v.list, /<small>09:00 ~ 10:00 · /);
  // 처음과 마지막이 같은 분이면(잠깐 한 일) 시각 하나만
  assert.match(dayView({ ...j, projects: [proj('blog', { last: at(11, 15, 9) + 30000 })] }, { now: NOW }).list, /<small>09:00 · /);
  // 프로젝트를 골라 봤으면: 제목 옆 풀기 버튼, 고르기 버튼은 없다, 비었을 때 그 이름으로
  const one = dayView({ ...j, projects: [proj('blog')] }, { project: 'blog', now: NOW });
  assert.match(one.title, /^📓 11월 15일 업무 일지 · blog<small>오늘<\/small><button type="button" class="jp-clear"[^>]*>✕ blog만<\/button>$/);
  assert.ok(!one.list.includes('jp-only'));
  assert.equal(dayView({ ...j, today: false, projects: [] }, { day: -2, project: 'blog', now: NOW }).list, "<p class=\"jp-empty\">'blog'에서 이날은 일한 기록이 없어요</p>");
});

test('한 주: 요일 막대는 오늘을 0으로 그날을 가리키고, 오늘은 진하게', () => {
  const days = [9, 10, 11, 12, 13, 14, 15].map(d => ({ since: at(11, d), workedMs: d === 15 ? 30 * 60000 : 0, tools: d === 15 ? 5 : 0 }));
  const j = { title: '11월 9일(월)~11월 15일(일) 주간 업무 일지', today: true, days, worked: 1, totals: { workedMs: 1800000, prompts: 1, tools: 5, errors: 0, tokens: 0 }, projects: [proj('blog', { sessions: Array.from({ length: 10 }, (_, i) => ({ file: `/p/${i}`, title: `세션 ${i}`, workedMs: 60000 })) })] };
  const v = weekView(j, { week: 0, now: NOW });
  assert.match(v.title, /<small>이번 주<\/small>$/);
  assert.equal(v.since, at(11, 9));
  assert.deepEqual([...v.hours.html.matchAll(/<span[^>]*data-day="(-?\d+)"/g)].map(m => Number(m[1])), [-6, -5, -4, -3, -2, -1, 0]);
  assert.match(v.hours.html, /<i class="now" data-day="0"/);
  assert.match(v.totals, /<b>1\/7<\/b><span>일한 날<\/span>/);
  assert.match(v.list, /<button type="button" class="jp-more"[^>]*>그 밖에 세션 2개 더 보기<\/button>/); // 세션은 8개까지 보이고
  assert.equal((v.list.match(/<li data-file=/g) || []).length, 10); // 나머지 둘도 숨겨 두었다가 '더 보기'로 펼친다
  assert.equal((v.list.match(/<li data-file="[^"]*" tabindex="0" role="button" hidden/g) || []).length, 2);
  assert.match(weekView({ ...j, today: false }, { week: -1, now: NOW }).title, /<small>지난 주<\/small>/);
});

test('한 달: 주 막대는 이번 주를 0으로 그 주를 가리킨다', () => {
  const weeks = [[1, 1], [2, 8], [9, 15]].map(([a, b]) => ({ from: at(11, a), to: at(11, b), workedMs: 60000, worked: 1, tools: 1 }));
  const j = { title: '2026년 11월 업무 일지 (11/1~11/15)', today: true, weeks, days: 15, worked: 3, totals: { workedMs: 180000, prompts: 3, tools: 3, errors: 0, tokens: 0 }, projects: [] };
  const v = monthView(j, { month: 0, now: NOW });
  assert.deepEqual([...v.hours.html.matchAll(/<span[^>]*data-week="(-?\d+)"/g)].map(m => Number(m[1])), [-2, -1, 0]);
  assert.match(v.hours.html, /<b>11\/1<\/b>/); // 하루뿐인 주는 날짜 하나
  assert.match(v.hours.html, /<b>11\/2~<wbr>11\/8<\/b>/); // 좁은 칸에서는 ~ 다음에서 줄을 바꾼다
  assert.match(v.hours.html, /aria-label="11\/2~11\/8 주간 일지 보기"/);
  assert.equal(v.hours.n, 3);
  assert.equal(v.list, '<p class="jp-empty">이번 달에는 아직 일한 기록이 없어요</p>');
});
