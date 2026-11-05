// 업무 일지를 글로 쓰는 부분(lib/report.js): 터미널용과 마크다운(하루 보고용).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { journalText, journalMarkdown, parseDay, parseWeek, weekText, weekMarkdown, parseMonth, monthMarkdown } = require('../lib/report');

const since = new Date(2026, 10, 2).getTime();
const at = (h, m) => new Date(2026, 10, 2, h, m).getTime();
const hours = Array(24).fill(0);
hours[9] = 4; hours[14] = 10;
const j = {
  since, today: false, hours,
  totals: { workedMs: 95 * 60000, projects: 1, sessions: 2, prompts: 5, tools: 14, errors: 1, interns: 1, tokens: 123456 },
  projects: [{
    project: 'shop', first: at(9, 5), last: at(14, 40), workedMs: 95 * 60000, prompts: 5, tools: 14, errors: 1, interns: 1, tokens: 123456,
    rooms: { library: 6, dev: 4, server: 3, search: 1, meeting: 0, desk: 0 },
    sessions: [{ title: '로그인 401 고치기', workedMs: 80 * 60000 }, { title: '테스트 정리', workedMs: 15 * 60000 }],
  }],
};

test('마크다운: 날짜 제목, 하루 합계, 프로젝트마다 시간과 세션 목록', () => {
  const md = journalMarkdown(j);
  assert.match(md, /^## 11월 2일 업무 일지\n/);
  assert.match(md, /일한 시간 1시간 35분 · 프로젝트 1 · 세션 2 · 내 메시지 5 · 도구 14 · 실패 1 · 인턴 1 · 출력 토큰 12.3만/);
  assert.match(md, /### shop\n09:05~14:40 · 1시간 35분 · 메시지 5 · 도구 14 · 실패 1 · 인턴 1명 · 출력 토큰 12.3만/);
  assert.match(md, /- 로그인 401 고치기 \(1시간 20분\)\n- 테스트 정리 \(15분\)/);
  assert.equal(journalMarkdown({ since, today: true, projects: [] }), '## 11월 2일 업무 일지\n\n오늘은 아직 일한 기록이 없어요\n');
});

test('터미널: 시간대 막대와 방별 사용량도 나온다', () => {
  const t = journalText(j);
  assert.match(t, /📓 11월 2일 업무 일지/);
  assert.match(t, /시간대  ·········▄····█·········/);
  assert.match(t, /📚 6  💻 4  🖥️ 3/);
});

test('--journal 뒤에 적은 날: 오늘·어제·그저께, -3·3일 전, 10/31·10월 31일, 2026-10-31', () => {
  const now = new Date(2026, 10, 3, 23, 0); // 11월 3일
  for (const [v, want] of [['', 0], ['오늘', 0], ['today', 0], ['어제', -1], ['Yesterday', -1], ['그저께', -2], ['그제', -2], ['-3', -3], ['3일 전', -3], ['3일전', -3]]) {
    assert.equal(parseDay(v, now), want, v);
  }
  assert.equal(parseDay('2026-10-31', now), '2026-10-31');
  assert.equal(parseDay('2026-1-5', now), '2026-01-05');
  assert.equal(parseDay('10/31', now), '2026-10-31');
  assert.equal(parseDay('10.31', now), '2026-10-31');
  assert.equal(parseDay('10월 31일', now), '2026-10-31');
  assert.equal(parseDay('12월 25일', now), '2025-12-25'); // 아직 안 온 날은 작년
  // 모르는 말·없는 날은 오늘로 넘기지 않고 null (터미널에 무엇이 틀렸는지 알려 준다)
  for (const v of ['abc', '2026-13-45', '2/30', '내일']) assert.equal(parseDay(v, now), null, v);
});

test('예약해 둔 작업이 시작한 차례는 내 메시지와 따로 센다 (없으면 안 보여 준다)', () => {
  const md = journalMarkdown({ ...j, totals: { ...j.totals, scheduled: 12 }, projects: j.projects.map(p => ({ ...p, scheduled: 12 })) });
  assert.match(md, /내 메시지 5 · 예약 작업 12 · 도구 14/);
  assert.match(md, /메시지 5 · 예약 작업 12 · 도구 14/);
  assert.ok(!journalMarkdown(j).includes('예약 작업'));
});

test('주간 일지: 이번 주는 월요일부터 오늘까지, 지난 주는 월~일', () => {
  const thu = new Date(2026, 10, 5, 12); // 목요일
  assert.deepEqual(parseWeek('이번 주', thu), { from: -3, to: 0 });
  assert.deepEqual(parseWeek('이번주', thu), { from: -3, to: 0 });
  assert.deepEqual(parseWeek('지난 주', thu), { from: -10, to: -4 });
  const sun = new Date(2026, 10, 8, 12); // 일요일이면 이번 주는 월~일 7일
  assert.deepEqual(parseWeek('week', sun), { from: -6, to: 0 });
  assert.deepEqual(parseWeek('2주 전', thu), { from: -17, to: -11 });
  assert.deepEqual(parseWeek('-2주', thu), parseWeek('2주 전', thu));
  assert.deepEqual(parseWeek('1주 전', thu), parseWeek('지난 주', thu));
  assert.equal(parseWeek('어제', thu), null);
  assert.equal(parseWeek('3일 전', thu), null);
});

test('주간 일지: 날마다 막대와 합계, 프로젝트는 여러 날을 합치고 세션도 합친다', () => {
  const day = (d, p) => ({ since: new Date(2026, 10, d).getTime(), today: false, hours: Array(24).fill(0), totals: p ? { workedMs: p.workedMs, prompts: p.prompts, tools: p.tools, errors: 0, interns: 0, tokens: 0, scheduled: p.scheduled || 0 } : { workedMs: 0, tools: 0 }, projects: p ? [p] : [] });
  const shop = (min, extra = {}) => ({ project: 'shop', cwd: '/w/shop', workedMs: min * 60000, prompts: 2, tools: 10, errors: 0, interns: 0, tokens: 0, sessions: [{ id: 's1', title: '로그인 고치기', workedMs: min * 60000 }], ...extra });
  const days = [day(2, shop(60)), day(3, null), day(4, shop(30, { scheduled: 3 }))];
  const md = weekMarkdown(days);
  assert.match(md, /^## 11월 2일\(월\)~11월 4일\(수\) 주간 업무 일지\n/);
  assert.match(md, /일한 시간 1시간 30분 · 일한 날 2\/3 · 내 메시지 4 · 예약 작업 3 · 도구 20/);
  assert.match(md, /- 11\/2 \(월\): 1시간 · 도구 10\n- 11\/3 \(화\): 쉼\n- 11\/4 \(수\): 30분 · 도구 10/);
  assert.match(md, /### shop\n1시간 30분 · 2일 · 메시지 4 · 예약 작업 3 · 도구 20\n\n- 로그인 고치기 \(1시간 30분\)/);
  const text = weekText(days);
  assert.match(text, /11\/2 \(월\)\s+█{12}\s+1시간 · 도구 10/);
  assert.match(text, /11\/3 \(화\)\s+·\s+-/);
  assert.match(weekText([day(3, null)]), /일한 기록이 없어요/);
});

test('월간 일지: 이번 달은 1일부터 오늘까지, 지난 달·10월은 그 달 전체 (아직 안 온 달은 작년)', () => {
  const now = new Date(2026, 10, 5, 12); // 11월 5일
  assert.deepEqual(parseMonth('이번 달', now), { from: -4, to: 0, month: '2026년 11월' });
  assert.deepEqual(parseMonth('지난 달', now), { from: -35, to: -5, month: '2026년 10월' });
  assert.deepEqual(parseMonth('10월', now), parseMonth('지난달', now));
  assert.equal(parseMonth('12월', now).month, '2025년 12월');
  assert.equal(parseMonth('1월', new Date(2026, 0, 15)).month, '2026년 1월'); // 지난 달이 작년이어도
  assert.equal(parseMonth('지난 달', new Date(2026, 0, 15)).month, '2025년 12월');
  assert.equal(parseMonth('10월 31일', now), null);
  assert.equal(parseMonth('13월', now), null);
});

test('월간 일지: 주마다(월요일부터) 묶고, 프로젝트는 그 달을 합친다', () => {
  const day = (d, min) => ({ since: new Date(2026, 9, d).getTime(), totals: min ? { workedMs: min * 60000, prompts: 1, tools: 5, errors: 0, interns: 0, tokens: 0 } : { workedMs: 0, tools: 0 }, projects: min ? [{ project: 'blog', cwd: '/w/blog', workedMs: min * 60000, prompts: 1, tools: 5, errors: 0, interns: 0, tokens: 0, sessions: [{ id: 'a', title: '글쓰기', workedMs: min * 60000 }] }] : [] });
  // 10/1(목)~10/6(화): 첫 주는 1~4일, 다음 주는 5일(월)부터
  const days = [day(1, 30), day(2, 0), day(3, 0), day(4, 30), day(5, 60), day(6, 0)];
  const md = monthMarkdown(days, '2026년 10월');
  assert.match(md, /^## 2026년 10월 업무 일지 \(10\/1~10\/6\)\n/);
  assert.match(md, /일한 시간 2시간 · 일한 날 3\/6/);
  assert.match(md, /- 10\/1~10\/4: 1시간 · 2일 · 도구 10\n- 10\/5~10\/6: 1시간 · 1일 · 도구 5/);
  assert.match(md, /### blog\n2시간 · 3일 · 메시지 3 · 도구 15/);
});
