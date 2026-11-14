// 회의실 화이트보드: 할 일이 많을 때 어느 14줄을 적을지
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

let boardWindow, boardSize;
test.before(async () => {
  ({ boardWindow, boardSize } = await import('../public/js/board.js'));
});

const plan = (n, doneUpTo, doing = true) => Array.from({ length: n }, (_, i) => ({
  text: `일 ${i + 1}`, status: i < doneUpTo ? 'done' : i === doneUpTo && doing ? 'doing' : 'todo',
}));
const texts = items => items.map(i => i.text);

test('14줄 이하면 다 적는다', () => {
  assert.equal(boardWindow(plan(5, 2)).length, 5);
});

test('많으면 지금 하는 일 위로 세 줄을 남기고 14줄', () => {
  const w = boardWindow(plan(20, 10));
  assert.equal(w.length, 14);
  assert.equal(w[0].text, '일 7'); // 지금 하는 일(11번째) 위로 세 줄
  assert.ok(texts(w).includes('일 11'));
});

test('앞쪽 일을 하는 중이면 처음부터, 끝쪽이면 마지막 14줄', () => {
  assert.equal(boardWindow(plan(20, 1))[0].text, '일 1');
  assert.deepEqual(texts(boardWindow(plan(20, 18))).slice(-1), ['일 20']);
});

test('다 끝났으면 방금 끝낸 마지막 14줄을 적는다 (처음 14줄이 아니라)', () => {
  const w = boardWindow(plan(20, 20, false));
  assert.equal(w[0].text, '일 7');
  assert.equal(w[13].text, '일 20');
});

test('줄이 많을수록 글씨가 작다', () => {
  assert.deepEqual([boardSize(4), boardSize(6), boardSize(7)], ['m', 's', 'xs']);
});
