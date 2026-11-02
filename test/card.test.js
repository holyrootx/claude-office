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
  assert.match(html, /<b>로그인 401 고치기<\/b><small>shop · opus-5-5 · ⎇ fix\/auth<\/small>/);
  assert.match(html, /12초째/);
  assert.match(html, /도구 7 · 실패 1 · 내 메시지 2 · 인턴 1명/);
  assert.match(html, /href="https:\/\/github.com\/o\/r\/pull\/86"/);
  assert.match(html, /\$1\.23 · \+10 −2줄/);
  assert.match(html, /🛡 계획 모드/);
  assert.match(html, /기다리는 내 메시지 4개/);
  assert.equal((html.match(/<small>(하나|둘|셋|넷)<\/small>/g) || []).length, 3); // 앞의 셋만
  assert.match(html, /card-ctx now-ctx mid" style="--p:72%"/);
  assert.match(html, /data-act="replay"/);
  assert.match(html, /data-act="pin"/);
  assert.match(html, /title="cd &#39;\/u\/shop&#39; &amp;&amp; claude --resume sid-1"/);
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

test('이 세션만 볼 때는 고정 버튼이 없고, 데모·다시 보기에서는 버튼이 다 없다', () => {
  assert.doesNotMatch(cardHtml(main, session(), { live: true, pinned: true }), /data-act="pin"/);
  assert.doesNotMatch(cardHtml(main, session(), { live: false }), /card-acts/);
  // Windows면 PowerShell 꼴
  assert.match(cardHtml(main, session({ cwd: 'C:\\code\\shop' }), { live: true, win: true }), /cd &quot;C:\\code\\shop&quot;; claude --resume sid-1/);
});

test('인턴 카드: 누구의 인턴인지만, 숫자·버튼·비용은 없다', () => {
  const html = cardHtml({ intern: true, name: 'Explore', desc: '원인 찾기', now }, session({ cost: { usd: 3 } }), { live: true });
  assert.match(html, /<em>인턴<\/em> Explore/);
  assert.match(html, /원인 찾기 · 로그인 401 고치기의 인턴/);
  assert.doesNotMatch(html, /card-nums|card-acts|💵/);
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
