// 업무 일지를 글로 쓰는 부분(lib/report.js): 터미널용과 마크다운(하루 보고용).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { journalText, journalMarkdown } = require('../lib/report');

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
