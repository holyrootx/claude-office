// 오른쪽 활동 기록(public/js/feed.js): '이 층만'으로 다른 층 줄을 가리고, 줄 수가 넘치면 오래된 것부터 지운다.
// 브라우저 없이 돌리려고, 활동 기록이 쓰는 만큼만 흉내 낸 아주 작은 가짜 DOM을 쓴다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function classes() {
  const set = new Set();
  return {
    set,
    add: (...c) => c.forEach(x => set.add(x)),
    remove: (...c) => c.forEach(x => set.delete(x)),
    toggle: (c, on) => ((on === undefined ? !set.has(c) : on) ? set.add(c) : set.delete(c)),
    contains: c => set.has(c),
  };
}
function fakeList() {
  const children = [];
  const list = {
    children,
    classList: classes(),
    get lastElementChild() { return children[children.length - 1] || null; },
    set innerHTML(v) { if (v === '') children.length = 0; },
    prepend(li) { li.parent = list; children.unshift(li); },
  };
  return list;
}
globalThis.document = {
  createElement: () => {
    const li = {
      dataset: {}, classList: classes(), innerHTML: '',
      remove() { const c = li.parent.children; c.splice(c.indexOf(li), 1); },
    };
    Object.defineProperty(li, 'className', { set(v) { v.split(' ').forEach(x => x && li.classList.add(x)); } });
    return li;
  },
};

let createFeed;
test.before(async () => {
  ({ createFeed } = await import('../public/js/feed.js'));
});

const person = floor => ({ s: { floor, color: '#000' }, a: { key: floor + ':main', name: floor } });
const say = text => ({ k: 'say', text, ts: Date.now() });
const shown = list => list.children.filter(li => !li.classList.contains('away')).map(li => li.dataset.floor);

test("'이 층만'을 켜면 다른 층 줄은 가려지고, 끄면 다시 다 보인다", () => {
  const list = fakeList();
  const feed = createFeed(list, { manyPeople: () => true });
  const A = person('A'), B = person('B');
  feed.add(A.s, A.a, say('a1'));
  feed.add(B.s, B.a, say('b1'));
  assert.deepEqual(shown(list), ['B', 'A']);

  feed.only('A');
  assert.deepEqual(shown(list), ['A']);
  assert.ok(list.classList.contains('only'));

  // 켜 둔 동안 새로 들어온 다른 층 줄도 가려진 채로 쌓인다
  feed.add(B.s, B.a, say('b2'));
  feed.add(A.s, A.a, say('a2'));
  assert.deepEqual(shown(list), ['A', 'A']);
  assert.equal(list.children.length, 4); // 가린 줄도 지우지 않는다

  feed.only('B');
  assert.deepEqual(shown(list), ['B', 'B']);

  feed.only(null);
  assert.deepEqual(shown(list), ['A', 'B', 'B', 'A']);
  assert.ok(!list.classList.contains('only'));
});

test('줄이 200개를 넘으면 가장 오래된 줄부터 지운다', () => {
  const list = fakeList();
  const feed = createFeed(list, { manyPeople: () => false });
  const A = person('A');
  for (let i = 0; i < 205; i++) feed.add(A.s, A.a, say('줄 ' + i));
  assert.equal(list.children.length, 200);
  assert.match(list.lastElementChild.innerHTML, /줄 5</);
  assert.match(list.children[0].innerHTML, /줄 204</);
});
