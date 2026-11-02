// 로비 안내판(public/js/lobby.js): 나를 기다리는 사람이 맨 위, 시간 칸, 기다리는 메시지, 글자 처리.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

let lobbyHtml, lobbyTime;
test.before(async () => {
  ({ lobbyHtml, lobbyTime } = await import('../public/js/lobby.js'));
});

const person = (key, floor, status, o = {}) => ({
  key, floor, status, name: key, intern: false, leaving: false, lastEventTs: 0,
  now: { icon: '💭', title: '생각 중', time: '' }, ...o,
});
const session = (main, interns = [], info = {}) => ({ color: '#D97757', main, interns: new Map(interns.map(a => [a.key, a])), info: { queue: [], ...info } });
const names = html => [...html.matchAll(/data-actor="([^"]+)"/g)].map(m => m[1]);

test('나를 기다리는 사람(권한 대기 → 질문)이 맨 위, 나머지는 층 순서, 인턴은 자기 직원 뒤', () => {
  const a = person('a', 'A', 'work');
  const ai = person('a-intern', 'A', 'work', { intern: true });
  const b = person('b', 'B', 'ask');
  const c = person('c', 'C', 'idle');
  const d = person('d', 'D', 'wait');
  const sessions = new Map([['a', session(a, [ai])], ['b', session(b)], ['c', session(c)], ['d', session(d)]]);
  const floors = [{ key: 'A', sids: ['a'] }, { key: 'B', sids: ['b'] }, { key: 'C', sids: ['c'] }, { key: 'D', sids: ['d'] }];
  assert.deepEqual(names(lobbyHtml(floors, sessions, 'A')), ['d', 'b', 'a', 'a-intern', 'c']);
});

test('줄 모양: 층 번호, 지금 층 표시, 인턴 표시, 기다리는 내 메시지(직원만), 퇴근하는 사람은 빼기', () => {
  const a = person('a', 'A', 'work');
  const ai = person('a-intern', 'A', 'work', { intern: true });
  const gone = person('gone', 'A', 'idle', { intern: true, leaving: true });
  const html = lobbyHtml([{ key: 'A', sids: ['a'] }], new Map([['a', session(a, [ai, gone], { queue: ['하나', '둘'] })]]), 'A');
  assert.match(html, /class="lb work here" data-floor="A" data-actor="a"/);
  assert.match(html, /<b>1F<\/b><span class="nm">a <small class="q"[^>]*>📨2<\/small><\/span>/);
  assert.match(html, /class="lb work here intern"[^>]*><b>1F<\/b><span class="nm"><em>인턴<\/em>a-intern<\/span>/);
  assert.doesNotMatch(html, /gone/);
  assert.equal(lobbyHtml([], new Map(), null), '<li class="lb none">아직 아무도 출근하지 않았어요</li>');
});

test('시간 칸: 하는 일의 경과 시간, 사용 한도면 풀리는 때, 쉬거나 멈췄으면 마지막으로 일한 때', () => {
  assert.equal(lobbyTime(person('a', 'A', 'work', { now: { time: '12초째' } })), '12초째');
  assert.equal(lobbyTime(person('a', 'A', 'limit', { halt: { resets: '오전 5:30' } })), '~오전 5:30');
  assert.equal(lobbyTime(person('a', 'A', 'sleep', { lastEventTs: Date.now() - 5 * 60000 })), '5분 전');
  assert.equal(lobbyTime(person('a', 'A', 'stopped', { lastEventTs: Date.now() - 5 * 60000 })), '5분 전');
  assert.equal(lobbyTime(person('a', 'A', 'think')), '');
});

test('이름·상태에 든 HTML은 글자로 나온다', () => {
  const a = person('a', 'A', 'idle', { name: '<img src=x>', now: { icon: '💬', title: '<b>굵게</b>', time: '' } });
  const html = lobbyHtml([{ key: 'A', sids: ['a'] }], new Map([['a', session(a)]]), 'A');
  assert.doesNotMatch(html, /<img|<b>굵게/);
  assert.match(html, /&lt;img src=x&gt;/);
});
