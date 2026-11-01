// 화면 쪽 캐릭터(public/js/actor.js)가 기록을 보고 지금 어떤 상태인지 제대로 판단하는지 확인한다.
// 브라우저 없이 돌리려고, Actor가 쓰는 만큼만 흉내 낸 아주 작은 가짜 DOM을 쓴다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function fakeEl() {
  const cls = new Set();
  return {
    classList: {
      add: (...c) => c.forEach(x => cls.add(x)),
      remove: (...c) => c.forEach(x => cls.delete(x)),
      toggle: (c, on) => ((on === undefined ? !cls.has(c) : on) ? cls.add(c) : cls.delete(c)),
      contains: c => cls.has(c),
    },
    style: { setProperty() {} },
    hidden: false, innerHTML: '', textContent: '', className: '', offsetWidth: 120, offsetHeight: 40,
    querySelector: () => fakeEl(),
    append() {}, appendChild() {}, remove() {}, addEventListener() {},
  };
}
globalThis.document = {
  getElementById: () => ({ content: { firstElementChild: { cloneNode: () => fakeEl() } } }),
  createElement: () => fakeEl(),
};

let Actor;
test.before(async () => {
  ({ Actor } = await import('../public/js/actor.js'));
});

// 화면 전체 역할을 하는 가짜: 자리는 늘 0번, 같은 세션 사람들의 최근 기록 시각을 알려 준다
function office() {
  const list = [];
  return {
    list,
    actorsEl: fakeEl(),
    claim(a, room) { a.slotRoom = room; a.slot = 0; return 0; },
    plan: () => 0,
    userSay() {},
    remove() {},
    activityOf: a => Math.max(0, ...list.filter(x => x.sid === a.sid).map(x => x.lastEventTs)),
  };
}
function actor(o, opts = {}) {
  const a = new Actor(o, { key: opts.agent ? 's:' + opts.agent : 's', sid: 's', ...opts });
  o.list.push(a);
  return a;
}
const ago = min => Date.now() - min * 60000;
const tool = (id, name, room, min, extra = {}) => ({ k: 'tool', ts: ago(min), id, name, tool: name, room, label: name, ...extra });

test('나에게 한 질문은 20분이 지나도 기다리는 중으로 남는다', () => {
  const a = actor(office());
  a.load([{ k: 'user', ts: ago(21), text: 'x' }, tool('q', 'AskUserQuestion', 'desk', 20, { ask: '어느 쪽?' })]);
  assert.equal(a.status, 'ask');
  assert.equal(a.room, 'desk');
});

test('실행 중인 도구는 30분까지 일하는 중이고, 40분 조용하면 정리한다', () => {
  const b = actor(office());
  b.load([{ k: 'user', ts: ago(21), text: 'x' }, tool('b', 'Bash', 'server', 20)]);
  assert.equal(b.status, 'work');
  assert.equal(b.room, 'server');
  const c = actor(office());
  c.load([{ k: 'user', ts: ago(41), text: 'x' }, tool('c', 'Bash', 'server', 40)]);
  assert.equal(c.pending.size, 0);
  assert.equal(c.status, 'sleep');
  assert.equal(c.room, 'desk');
});

test('생각만 하다 15분 조용하면 정리한다', () => {
  const a = actor(office());
  a.load([{ k: 'user', ts: ago(16), text: 'x' }, { k: 'think', ts: ago(15), text: '음' }]);
  assert.equal(a.turnOpen, false);
  assert.equal(a.status, 'sleep');
});

test('같은 세션 인턴이 일하고 있으면 메인 직원은 잠들지 않는다', () => {
  const o = office();
  const intern = actor(o, { agent: 'i1', intern: true });
  intern.load([tool('r', 'Read', 'library', 1, { agent: 'i1' })]);
  const main = actor(o);
  main.load([{ k: 'user', ts: ago(41), text: 'x' }, tool('ag', 'Agent', 'meeting', 40)]);
  assert.equal(main.status, 'work');
  assert.equal(main.room, 'meeting');
  assert.equal(intern.room, 'library');
});

test('권한 대기는 무엇보다 먼저 보이고, 풀리면 하던 일로 돌아간다', () => {
  const a = actor(office());
  const w = { kind: 'permission', ts: Date.now(), id: 'b', tool: 'Bash', label: '배포' };
  a.load([{ k: 'user', ts: ago(1), text: 'x' }, tool('b', 'Bash', 'server', 1)], w);
  assert.equal(a.status, 'wait');
  assert.equal(a.room, 'desk');
  assert.equal(a.now.mode, 'wait');
  a.setWait(null);
  assert.equal(a.status, 'work'); // 서버실로 다시 걸어가는 중
});

test('마지막 답이 오면 하던 일과 턴이 끝난다', () => {
  const a = actor(office());
  a.bookkeep(tool('t', 'Edit', 'dev', 0));
  assert.equal(a.pending.size, 1);
  assert.equal(a.turnOpen, true);
  a.bookkeep({ k: 'say', ts: Date.now(), final: true, text: '다 했어요' });
  assert.equal(a.pending.size, 0);
  assert.equal(a.turnOpen, false);
  assert.equal(a.lastSay, '다 했어요');
});

test('인턴의 집은 회의실, 직원의 집은 내 자리', () => {
  const o = office();
  const i = actor(o, { agent: 'z', intern: true });
  i.load([]);
  assert.equal(i.room, 'meeting');
  const m = actor(o);
  m.load([]);
  assert.equal(m.room, 'desk');
});

test('사용 한도에 걸리면 생각 중이 아니라 한도가 풀릴 때까지 쉬는 중이고, 내가 말을 걸면 풀린다', () => {
  const a = actor(office());
  a.load([
    { k: 'user', ts: ago(3), text: '계속해 줘' },
    { k: 'think', ts: ago(2.5), text: '' },
    { k: 'apierr', ts: ago(2), kind: 'limit', text: '사용 한도에 걸렸어요', resets: '오전 12:40' },
  ]);
  assert.equal(a.turnOpen, false);
  assert.equal(a.now.title, '사용 한도에 걸려서 쉬어요');
  assert.equal(a.now.sub, '오전 12:40에 다시 열려요');
  assert.ok(a.el.classList.contains('sleep'));
  a.bookkeep({ k: 'turn_end', ts: Date.now() });
  assert.ok(a.halt, '턴 끝 줄로는 풀리지 않는다');
  a.bookkeep({ k: 'user', ts: Date.now(), text: '다시 해 줘' });
  assert.equal(a.halt, null);
});

test('끝내 멈춘 오류는 생각 중으로 남지 않고 왜 멈췄는지 보여 준다 (다시 시도 중인 오류는 그대로 일하는 중)', () => {
  const a = actor(office());
  a.load([
    { k: 'user', ts: ago(3), text: '계속' },
    { k: 'think', ts: ago(2.5), text: '' },
    { k: 'apierr', ts: ago(2), stop: true, text: '인터넷 연결이 끊겼어요' },
  ]);
  assert.equal(a.turnOpen, false);
  assert.equal(a.now.title, '오류로 일이 멈췄어요');
  assert.match(a.now.sub, /인터넷 연결이 끊겼어요/);
  const b = actor(office(), { key: 's2', sid: 's2' });
  b.load([{ k: 'user', ts: ago(1), text: '계속' }, { k: 'apierr', ts: ago(0.5), text: 'Anthropic 서버가 붐벼요 (529) · 다시 시도 1/7' }]);
  assert.equal(b.turnOpen, true);
  assert.equal(b.halt, undefined);
});

