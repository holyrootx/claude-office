// 캐릭터 정보 카드(public/js/card.js)에 무엇이 나오는지, 컨텍스트 색(util.js ctxOf)이 맞는지 본다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

let cardHtml, ctxOf;
test.before(async () => {
  ({ cardHtml } = await import('../public/js/card.js'));
  ({ ctxOf } = await import('../public/js/util.js'));
});

const now = { icon: '💻', title: '개발실 · Edit', time: '12초째', sub: 'src/auth.ts' };
const session = (info = {}) => ({
  sid: 'sid-1', color: '#D97757', main: { name: '로그인 401 고치기' }, interns: new Map([['x', {}]]),
  stats: { tools: 7, errors: 1, prompts: 2 },
  info: { title: '로그인 401 고치기', project: 'shop', model: 'claude-opus-5-5', branch: 'fix/auth', cwd: '/u/shop', file: '/f.jsonl', ...info },
});
const main = { intern: false, name: '로그인 401 고치기', now };

test('직원 카드: 제목·위치·숫자·PR·비용·권한 모드·기다리는 메시지·버튼', () => {
  const html = cardHtml(main, session({
    pr: { number: 86, url: 'https://github.com/o/r/pull/86' },
    cost: { usd: 1.234, added: 10, removed: 2 },
    mode: 'plan',
    queue: ['하나', '둘', '셋', '넷'],
  }), { ctx: { p: 72, level: 'mid', text: '14.4만 / 20만 토큰' }, live: true });
  assert.match(html, /<b>로그인 401 고치기<\/b><small>shop · Opus 5.5 · ⎇ fix\/auth<\/small>/); // 모델은 사람이 읽는 이름으로
  assert.match(html, /12초째/);
  assert.match(html, /도구 7 · <button[^>]*data-act="fails"[^>]*>실패 1<\/button> · 내 메시지 2 · 인턴 1명/);
  assert.match(html, /href="https:\/\/github.com\/o\/r\/pull\/86"/);
  assert.match(html, /\$1\.23 · \+10 −2줄/);
  assert.match(html, /<button type="button" class="card-tip card-mode" data-tip="파일을 고치거나 명령을 실행하지 않고 계획만[^"]*" title="[^"]*">🛡 계획 모드<\/button>/); // 무엇을 묻는지는 마우스를 올리거나 누르면
  assert.match(html, /기다리는 메시지 4개/);
  assert.equal((html.match(/<small>(하나|둘|셋|넷)<\/small>/g) || []).length, 3); // 앞의 셋만
  assert.match(html, /card-ctx now-ctx mid" style="--p:72%"/);
  assert.match(html, /data-act="replay"/);
  assert.match(html, /data-act="pin"/);
  assert.match(html, /title="cd &#39;\/u\/shop&#39; &amp;&amp; claude --resume sid-1"/);
});

test('오늘 이 세션이 일한 시간(업무 일지와 같은 셈)을 숫자 줄 끝에 붙인다 (1분 안 되면 안 붙인다)', () => {
  assert.match(cardHtml(main, session(), { today: 79 * 60000 }), /인턴 1명 · 오늘 1시간 19분<\/div>/);
  assert.ok(!cardHtml(main, session(), { today: 30000 }).includes('오늘'));
  assert.ok(!cardHtml(main, session()).includes('오늘'));
});

test('하위 폴더에서 일하는 중이면 머리에 📂 그 폴더를 붙이고, 이어 하기는 시작한 폴더로', () => {
  const html = cardHtml(main, session({ cwd: '/u/shop', here: '/u/shop/frontend/src' }), { live: true });
  assert.match(html, /⎇ fix\/auth · 📂 frontend\/src<\/small>/);
  assert.match(html, /cd &#39;\/u\/shop&#39; &amp;&amp; claude --resume/);
});

test('워크트리에서 일하면 🌿 그 이름을 붙인다 (워크트리에서 시작했든, 들어갔든)', () => {
  assert.match(cardHtml(main, session({ cwd: '/u/shop/.claude/worktrees/fix-login', home: '/u/shop', worktree: 'fix-login' }), { live: true }), /🌿 fix-login<\/small>/);
  assert.match(cardHtml(main, session({ cwd: '/u/shop', here: '/u/shop/.claude/worktrees/fix-login/backend' }), { live: true }), /🌿 fix-login · 📂 backend<\/small>/);
  // 이어 하기는 워크트리 폴더에서 (세션을 시작한 곳)
  assert.match(cardHtml(main, session({ cwd: '/u/shop/.claude/worktrees/fix-login', home: '/u/shop', worktree: 'fix-login' }), { live: true }), /cd &#39;\/u\/shop\/.claude\/worktrees\/fix-login&#39;/);
});

test('이 세션만 볼 때는 고정 버튼 대신 빌딩으로 돌아가는 버튼, 데모·다시 보기에서는 버튼이 다 없다', () => {
  assert.doesNotMatch(cardHtml(main, session(), { live: true, pinned: true }), /data-act="pin"/);
  assert.match(cardHtml(main, session(), { live: true, pinned: true }), /<button type="button" data-act="unpin"[^>]*>🏢 빌딩으로 돌아가기<\/button>/);
  assert.doesNotMatch(cardHtml(main, session(), { live: true }), /data-act="unpin"/);
  assert.doesNotMatch(cardHtml(main, session(), { live: false }), /card-acts/);
  // Windows 폴더면 PowerShell 꼴, WSL처럼 Windows 브라우저로 봐도 Linux 폴더면 sh 꼴 (폴더 경로로 정한다)
  assert.match(cardHtml(main, session({ cwd: 'C:\\code\\shop' }), { live: true }), /cd -LiteralPath &#39;C:\\code\\shop&#39;; claude --resume sid-1/);
  assert.match(cardHtml(main, session({ cwd: '/home/me/shop' }), { live: true }), /title="cd &#39;\/home\/me\/shop&#39; &amp;&amp; claude --resume sid-1"/);
});

test('인턴 카드: 누구의 인턴인지와 얼마나 일했는지, 버튼·비용은 없다', () => {
  const intern = { intern: true, name: 'Explore', desc: '원인 찾기', now, firstTs: Date.now() - 200000, toolCount: 12 };
  const html = cardHtml(intern, session({ cost: { usd: 3 } }), { live: true });
  assert.match(html, /<em>인턴<\/em> Explore/);
  assert.match(html, /원인 찾기 · 로그인 401 고치기의 인턴/);
  assert.match(html, /도구 12번 · 3분 20초째/);
  assert.doesNotMatch(html, /card-acts|💵/);
  // 일을 마쳤으면 걸린 시간으로
  assert.match(cardHtml({ ...intern, doneTs: intern.firstTs + 300000 }, session(), { live: true }), /도구 12번 · 5분 일했어요/);
  // 한 시간 넘게 일한 인턴은 '95분'이 아니라 '1시간 35분'
  assert.match(cardHtml({ ...intern, doneTs: intern.firstTs + 95 * 60000 }, session(), { live: true }), /도구 12번 · 1시간 35분 일했어요/);
});

test("실패가 있으면 '실패 N'을 누르면 활동 기록의 실패만 보기로 간다 (0이면 그냥 글자)", () => {
  const none = session();
  none.stats = { tools: 3, errors: 0, prompts: 1 };
  assert.match(cardHtml(main, none, { live: true }), /도구 3 · 실패 0 · 내 메시지 1/);
  assert.doesNotMatch(cardHtml(main, none, { live: true }), /data-act="fails"/);
  // 데모·다시 보기에서도 활동 기록은 있으니 누를 수 있다
  assert.match(cardHtml(main, session(), { live: false }), /data-act="fails"/);
});

test('PR 주소가 http(s)가 아니면 링크로 만들지 않는다', () => {
  assert.doesNotMatch(cardHtml(main, session({ pr: { number: 1, url: 'javascript:alert(1)' } }), { live: true }), /href=|PR #1/);
  assert.match(cardHtml(main, session({ pr: { number: 2, url: 'https://github.com/o/r/pull/2' } }), { live: true }), /href="https:\/\/github.com\/o\/r\/pull\/2"/);
});

test('세션 제목이나 메시지에 든 HTML은 글자로 나온다', () => {
  const html = cardHtml(main, session({ title: '<img src=x onerror=alert(1)>', queue: ['<b>굵게</b>'] }), { live: true });
  assert.doesNotMatch(html, /<img|<b>굵게/);
  assert.match(html, /&lt;img src=x/);
});

test('컨텍스트 색: 60%부터 노랑, 85%부터 빨강, 100%를 넘지 않는다', () => {
  const at = tokens => ctxOf({ info: { ctx: { tokens, window: 200000 } } });
  assert.equal(at(118000).level, 'low');
  assert.equal(at(120000).level, 'mid');
  assert.equal(at(170000).level, 'high');
  assert.equal(at(260000).p, 100);
  assert.equal(ctxOf({ info: {} }), null);
  assert.equal(ctxOf(null), null);
});

test('직원 카드: 세션을 언제 시작했는지 (오늘이면 시각, 전이면 날짜와 며칠째)', () => {
  const now = new Date(2026, 10, 16, 15, 0).getTime();
  const today = cardHtml(main, session({ started: new Date(2026, 10, 16, 9, 5).getTime() }), { clock: now });
  assert.match(today, /· 09:05부터<\/div>/);
  const old = cardHtml(main, session({ started: new Date(2026, 9, 24, 18, 28).getTime() }), { clock: now });
  assert.match(old, /· 10\/24부터 · 24일째<\/div>/);
  assert.doesNotMatch(cardHtml(main, session({}), { clock: now }), /부터/); // 모르면 안 쓴다
});

test("권한 모드 '모든 권한 허용'은 ⚠로 눈에 띄게, 기본 모드는 안 쓴다", () => {
  assert.match(cardHtml(main, session({ mode: 'bypassPermissions' })), /<button type="button" class="card-tip card-mode risky" data-tip="아무것도 묻지 않고[^"]*"[^>]*>⚠ 모든 권한 허용<\/button>/);
  assert.match(cardHtml(main, session({ mode: 'auto' })), /🛡 자동 모드/);
  assert.doesNotMatch(cardHtml(main, session({ mode: 'default' })), /card-mode/);
});

test("며칠째 이어지는 세션이면 '⏪ 오늘부터' 버튼도 (오늘 시작한 세션·인턴·데모에는 없다)", () => {
  const clock = new Date(2026, 10, 16, 15, 0).getTime();
  const old = cardHtml(main, session({ started: new Date(2026, 9, 24, 18, 28).getTime() }), { live: true, clock });
  assert.match(old, /data-act="replay"[^>]*>⏪ 다시 보기<\/button><button type="button" data-act="replay-today"[^>]*>⏪ 오늘부터<\/button>/);
  const today = cardHtml(main, session({ started: new Date(2026, 10, 16, 9, 0).getTime() }), { live: true, clock });
  assert.doesNotMatch(today, /replay-today/);
  assert.doesNotMatch(cardHtml(main, session({ started: new Date(2026, 9, 24).getTime() }), { live: false, clock }), /replay-today/);
});

test('예약 작업이 도는 세션이면 카드 숫자 줄에 다음 예약 시각 (닫았으면 빼기)', () => {
  const m = 60000, clock = Date.parse('2026-11-21T18:20:00+09:00');
  const sched = { every: 30 * m, anchor: Date.parse('2026-11-21T17:28:00+09:00'), last: Date.parse('2026-11-21T17:58:00+09:00') };
  const s = session({ sched });
  assert.match(cardHtml(main, s, { clock }), /<span class="card-next" title="지난 예약 작업\(크론·\/loop\)이 30분 간격으로[^"]*">⏰ 다음 예약 18:28쯤<\/span><\/div>/);
  assert.doesNotMatch(cardHtml(main, { ...s, main: { ...s.main, ended: clock - 1000 } }, { clock }), /다음 예약/);
  assert.doesNotMatch(cardHtml(main, session(), { clock }), /다음 예약/);
});
