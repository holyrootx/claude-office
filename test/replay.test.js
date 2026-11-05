// 다시 보기 막대의 눈금(일을 시킨 자리)과 Shift+← →로 앞뒤 눈금 고르기
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

let requestMarks, nextMark;
test.before(async () => {
  ({ requestMarks, nextMark } = await import('../public/js/replay.js'));
});

const events = [
  { k: 'user', text: '로그인 고쳐 줘' }, // 0
  { k: 'tool' }, // 1
  { k: 'user', agent: 'i1', text: '인턴이 받은 일' }, // 2: 인턴이 받은 말은 눈금이 아니다
  { k: 'note', kind: 'task', text: '백그라운드 끝' }, // 3: 백그라운드 알림도 아니다
  { k: 'say', final: true }, // 4
  { k: 'note', kind: 'schedule', text: '자동 개선 1회' }, // 5
  { k: 'tool' }, // 6
  { k: 'note', kind: 'peer', from: '블로그', text: '인계 문서 받았어요' }, // 7
  { k: 'tool' }, // 8
];

test('눈금은 내 말·예약 작업·다른 세션이 보낸 말에만, 색과 글이 다르다', () => {
  const marks = requestMarks(events);
  assert.deepEqual(marks.map(m => [m.i, m.cls]), [[0, ''], [5, 'schedule'], [7, 'peer']]);
  assert.equal(marks[0].tip, '🙋 로그인 고쳐 줘');
  assert.equal(marks[1].tip, '⏰ 예약된 작업 · 자동 개선 1회');
  assert.equal(marks[2].tip, '📨 블로그 · 인계 문서 받았어요');
});

test('앞뒤 눈금: 지금 보는 일을 시킨 눈금 기준으로 하나 앞, 아직 안 본 다음 것', () => {
  const marks = requestMarks(events);
  // 6번(예약 작업으로 시작한 일)을 보고 있으면: 다음은 7, 앞은 예약 작업 바로 앞 눈금인 0
  assert.equal(nextMark(marks, 6, +1), 7);
  assert.equal(nextMark(marks, 6, -1), 0);
  // 눈금 자리(5)를 막 보여 줬으면 다음은 7, 앞은 0 (같은 자리에 머물지 않는다)
  assert.equal(nextMark(marks, 5, +1), 7);
  assert.equal(nextMark(marks, 5, -1), 0);
  // 아직 아무것도 안 봤으면(-1) 다음은 첫 눈금, 앞은 없다
  assert.equal(nextMark(marks, -1, +1), 0);
  assert.equal(nextMark(marks, -1, -1), null);
  // 마지막 눈금 뒤로는 없다
  assert.equal(nextMark(marks, 8, +1), null);
  assert.equal(nextMark([], 3, +1), null);
});
