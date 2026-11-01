// 빌딩의 층 판단(public/js/floors.js): 처음 볼 층, 자동으로 옮겨 갈 층, 같은 이름 층 구별.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

let firstFloor, nextFloor, floorLabel, QUIET_MS, FRESH_MS;
test.before(async () => {
  ({ firstFloor, nextFloor, floorLabel, QUIET_MS, FRESH_MS } = await import('../public/js/floors.js'));
});

const NOW = 1_000_000;
const p = (floor, o = {}) => ({ floor, waitState: null, status: 'idle', lastActivity: NOW - 60000, lastEventTs: NOW - 60000, ...o });

test('처음 볼 층: 나를 기다리는 직원이 있는 층이 먼저, 없으면 가장 최근에 일한 층', () => {
  assert.equal(firstFloor([p('A', { lastEventTs: NOW - 10 }), p('B', { lastEventTs: NOW - 99 })]), 'A');
  assert.equal(firstFloor([p('A', { lastEventTs: NOW - 10 }), p('B', { lastEventTs: NOW - 99, waitState: { ts: 1 } })]), 'B');
  assert.equal(firstFloor([], ['X', 'Y']), 'X');
  assert.equal(firstFloor([], []), null);
});

test('다른 층에서 누가 나를 기다리면(권한 대기·질문) 바로 그리로 간다', () => {
  assert.equal(nextFloor('A', [p('A', { lastActivity: NOW - 100 }), p('B', { waitState: { ts: 1 } })], NOW), 'B');
  assert.equal(nextFloor('A', [p('A', { lastActivity: NOW - 100 }), p('B', { status: 'ask' })], NOW), 'B');
});

test('지금 층에도 나를 기다리는 사람이 있으면 그대로 있는다', () => {
  assert.equal(nextFloor('A', [p('A', { status: 'ask' }), p('B', { waitState: { ts: 1 } })], NOW), null);
});

test('지금 층이 조용하고 다른 층에서 방금 일이 생겼을 때만 옮긴다', () => {
  const quietHere = p('A', { lastActivity: NOW - QUIET_MS - 1 });
  const busyHere = p('A', { lastActivity: NOW - 1000 });
  const freshThere = p('B', { lastActivity: NOW - 500 });
  const staleThere = p('B', { lastActivity: NOW - FRESH_MS - 1 });
  assert.equal(nextFloor('A', [quietHere, freshThere], NOW), 'B');
  assert.equal(nextFloor('A', [busyHere, freshThere], NOW), null); // 지금 층이 아직 바쁘다
  assert.equal(nextFloor('A', [quietHere, staleThere], NOW), null); // 다른 층도 조용하다
  // 여러 층이 방금 움직였으면 가장 최근 층으로
  assert.equal(nextFloor('A', [quietHere, freshThere, p('C', { lastActivity: NOW - 100 })], NOW), 'C');
});

test('이름이 같은 층은 바로 위 폴더 이름을 붙여 구별한다', () => {
  const floors = new Map([
    ['/u/work/blog', { name: 'blog' }],
    ['/u/personal/blog', { name: 'blog' }],
    ['/u/shop', { name: 'shop' }],
  ]);
  assert.equal(floorLabel(floors, '/u/work/blog'), 'blog · work');
  assert.equal(floorLabel(floors, '/u/personal/blog'), 'blog · personal');
  assert.equal(floorLabel(floors, '/u/shop'), 'shop');
  assert.equal(floorLabel(new Map([['C:\\code\\a\\blog', { name: 'blog' }], ['C:\\code\\b\\blog', { name: 'blog' }]]), 'C:\\code\\b\\blog'), 'blog · b');
  assert.equal(floorLabel(floors, '/없는/층'), '');
});
