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
      // <time>의 글자만 바꿀 수 있게
      querySelector: sel => (sel === 'time' ? { set textContent(v) { li.innerHTML = li.innerHTML.replace(/<time>[^<]*<\/time>/, `<time>${v}</time>`); } } : null),
    };
    Object.defineProperty(li, 'className', { set(v) { v.split(' ').forEach(x => x && li.classList.add(x)); } });
    return li;
  },
};

let createFeed, scheduleName;
test.before(async () => {
  ({ createFeed, scheduleName } = await import('../public/js/feed.js'));
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

test("'실패만': 실패·오류·중단 줄 수를 알려 주고, 켜면 그 줄만 남긴다", () => {
  const list = fakeList();
  const counts = [];
  const feed = createFeed(list, { manyPeople: () => false, onFails: n => counts.push(n) });
  const A = person('A');
  feed.add(A.s, A.a, { k: 'tool', id: 't1', tool: 'Bash', room: 'server', label: 'npm test', ts: Date.now() });
  feed.add(A.s, A.a, { k: 'result', id: 't1', ok: false, error: 'exit 1', ts: Date.now() });
  feed.add(A.s, A.a, say('고쳐 볼게요'));
  feed.add(A.s, A.a, { k: 'interrupt', ts: Date.now() });
  assert.deepEqual(counts, [1, 2]);
  assert.equal(feed.failCount(), 2);
  // 실패한 도구 줄은 ✗만 붙고, 따로 쌓인 '실패' 줄이 err다
  assert.deepEqual(list.children.map(li => li.classList.contains('err')), [true, false, true, false]);

  feed.failsOnly(true);
  assert.ok(list.classList.contains('fails'));
  feed.failsOnly(false);
  assert.ok(!list.classList.contains('fails'));

  // 오래된 실패 줄이 밀려 지워지면 수도 줄고, 다 지우면 0
  for (let i = 0; i < 199; i++) feed.add(A.s, A.a, say('줄 ' + i));
  assert.equal(feed.failCount(), 1);
  feed.clear();
  assert.equal(feed.failCount(), 0);
  assert.deepEqual(counts, [1, 2, 1, 0]);
});

test('예약해 둔 작업이 시작되면 ⏰ 예약된 작업 줄로', () => {
  const list = fakeList();
  const feed = createFeed(list, { manyPeople: () => false });
  const A = person('A');
  feed.add(A.s, A.a, { k: 'note', ts: Date.now(), kind: 'schedule', ok: true, text: '자동 개선 1회' });
  assert.match(list.children[0].innerHTML, /⏰[\s\S]*<b>예약된 작업<\/b> 자동 개선 1회/);
  // 긴 지시는 이름만 보이고, 전체는 줄의 title로
  feed.add(A.s, A.a, { k: 'note', ts: Date.now(), kind: 'schedule', ok: true, text: 'claude-office 자동 개선 1회: (1) 코드 분석으로 아쉬운 점 하나를 고르고 (2) 고치고' });
  assert.match(list.children[0].innerHTML, /<b>예약된 작업<\/b> claude-office 자동 개선 1회<\/div>/);
  assert.equal(list.children[0].title, 'claude-office 자동 개선 1회: (1) 코드 분석으로 아쉬운 점 하나를 고르고 (2) 고치고');
  assert.ok(!list.children[0].classList.contains('err'));
});

test("예약 작업 이름: 앞쪽의 ':' 앞까지, 없으면 60자로", () => {
  assert.equal(scheduleName('매일 아침 보고서: 어제 커밋을 정리해 줘'), '매일 아침 보고서');
  assert.equal(scheduleName('짧은 작업'), '짧은 작업');
  assert.equal(scheduleName('가'.repeat(80)), '가'.repeat(59) + '…');
  assert.equal(scheduleName('가'.repeat(45) + ': 뒤'), '가'.repeat(45) + ': 뒤'); // ':'가 40자 뒤면 이름으로 안 보고 60자까지 그대로
});

test('답이 끊겨 이어 쓰면 ✂️, 사용 한도가 거의 다 되면 ⏳ 줄 (실패로 세지 않는다)', () => {
  const list = fakeList();
  const feed = createFeed(list, { manyPeople: () => false });
  const A = person('A');
  feed.add(A.s, A.a, { k: 'note', ts: Date.now(), kind: 'resume', ok: true, text: '답이 중간에 끊겨서 이어서 써요' });
  feed.add(A.s, A.a, { k: 'note', ts: Date.now(), kind: 'limitsoon', ok: true, text: '사용 한도가 거의 다 됐어요' });
  assert.match(list.children[1].innerHTML, /<span class="ic">✂️<\/span>[\s\S]*이어서 써요/);
  assert.match(list.children[0].innerHTML, /<span class="ic">⏳<\/span>[\s\S]*거의 다 됐어요/);
  assert.equal(feed.failCount(), 0);
});

test('Claude Code를 닫으면 🚪 줄 (실패로 세지 않는다)', () => {
  const list = fakeList();
  const feed = createFeed(list, { manyPeople: () => false });
  const A = person('A');
  feed.add(A.s, A.a, { k: 'closed', ts: Date.now() });
  assert.match(list.children[0].innerHTML, /<span class="ic">🚪<\/span>[\s\S]*Claude Code를 닫았어요/);
  assert.equal(feed.failCount(), 0);
});

test('퇴근 줄: Claude Code를 닫았는지, 빌딩이 꽉 차서 자리를 내줬는지, 오래 조용했는지 따로 말한다', () => {
  const list = fakeList();
  const feed = createFeed(list, { manyPeople: () => false });
  const A = person('A');
  const leave = (why, max) => { feed.add(A.s, A.a, { k: 'leave', ts: Date.now(), why, max }); return list.children[0].innerHTML; };
  assert.match(leave('ended'), /Claude Code를 닫아서/);
  assert.match(leave('full', 12), /빌딩이 꽉 차서\(12명\) 가장 오래 조용한 직원이 자리를 내줬어요/);
  assert.match(leave('quiet'), /한동안 조용해서/);
  assert.match(leave(undefined), /한동안 조용해서/); // 예전 서버는 이유 없이 보냈다
});

test('오늘이 아닌 기록에는 날짜를 붙이고, 오늘 기록은 시각만', () => {
  const list = fakeList();
  const feed = createFeed(list, { manyPeople: () => false });
  const A = person('A');
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(14, 5, 9, 0);
  feed.add(A.s, A.a, { ...say('어제 한 말'), ts: yesterday.getTime() });
  assert.match(list.children[0].innerHTML, new RegExp(`^<time>${yesterday.getMonth() + 1}/${yesterday.getDate()} 14:05</time>`));
  feed.add(A.s, A.a, say('지금 한 말'));
  assert.match(list.children[0].innerHTML, /^<time>\d{2}:\d{2}:\d{2}<\/time>/);
});

test('켜 둔 채 자정을 넘기면 어제가 된 줄에도 날짜를 붙인다 (전에는 시각만 남아 밤 23:15 줄이 오늘 것처럼 보였다)', () => {
  const list = fakeList();
  const feed = createFeed(list, { manyPeople: () => false });
  const A = person('a');
  const late = new Date(); late.setHours(23, 15, 0, 0); // 오늘 밤 23:15에 한 말을, 다음 날 아침에 본다
  feed.add(A.s, A.a, { ...say('밤에 한 말'), ts: late.getTime() });
  assert.match(list.children[0].innerHTML, /^<time>23:15:00<\/time>/);
  feed.redate(Date.now()); // 아직 같은 날: 그대로
  assert.match(list.children[0].innerHTML, /^<time>23:15:00<\/time>/);
  const tomorrow = new Date(late); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(8, 0, 0, 0);
  feed.redate(tomorrow.getTime());
  assert.match(list.children[0].innerHTML, new RegExp(`^<time>${late.getMonth() + 1}/${late.getDate()} 23:15</time>`));
});

test('키보드: 활동 기록의 Tab 자리는 맨 위의 보이는 줄 하나뿐 (가린 줄은 건너뛴다)', () => {
  const list = fakeList();
  const feed = createFeed(list, { manyPeople: () => true });
  const A = person('a'), B = person('b');
  feed.add(A.s, A.a, say('a 첫 줄'));
  feed.add(B.s, B.a, { k: 'tool', id: 'f1', tool: 'Bash', room: 'server', label: 'npm test', ts: Date.now() });
  feed.add(B.s, B.a, { k: 'result', id: 'f1', ok: false, error: 'exit 1', ts: Date.now() });
  feed.add(A.s, A.a, say('a 새 줄'));
  const stops = () => list.children.filter(li => li.tabIndex === 0).map(li => li.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  assert.equal(stops().length, 1);
  assert.match(stops()[0], /a 새 줄/);
  assert.ok(list.children.slice(1).every(li => li.tabIndex === -1));
  feed.only('b'); // a 줄들은 가려진다: b의 가장 새 줄(실패 줄)로
  assert.equal(stops().length, 1);
  assert.match(stops()[0], /Bash 실패 exit 1/);
  feed.only(null);
  feed.failsOnly(true); // 실패 줄만
  assert.match(stops()[0], /Bash 실패 exit 1/);
  feed.failsOnly(false);
  assert.match(stops()[0], /a 새 줄/);
  feed.clear();
  assert.deepEqual(stops(), []);
});

test('MCP 도구 줄에 마우스를 올리면 실제 도구 이름 (방 바꾸기 설정에 쓰는 이름)', () => {
  const list = fakeList();
  const feed = createFeed(list, { manyPeople: () => false });
  const A = person('a');
  feed.add(A.s, A.a, { k: 'tool', id: 'm1', name: 'mcp__plugin_github_github__create_issue', tool: 'github.create_issue', room: 'search', label: '버그', ts: Date.now() });
  assert.equal(list.children[0].title, '도구 이름: mcp__plugin_github_github__create_issue');
  feed.add(A.s, A.a, { k: 'tool', id: 'r1', name: 'Read', tool: 'Read', room: 'library', label: 'a.ts', ts: Date.now() });
  assert.equal(list.children[0].title, undefined); // 보여 주는 이름과 같으면 붙이지 않는다
});
