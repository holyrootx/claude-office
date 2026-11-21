// 화면 쪽 작은 도구들(public/js/util.js): 이어 하기 명령, 토큰 숫자 꼴.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

let resumeCommand, fmtTokens, compactHow, codeNotice, ago, fmtWorked, isWinPath;
test.before(async () => {
  ({ resumeCommand, fmtTokens, compactHow, codeNotice, ago, fmtWorked, isWinPath } = await import('../public/js/util.js'));
});

test('이어 하기 명령: 그 폴더로 가서 claude --resume', () => {
  assert.equal(resumeCommand('/Users/me/shop', 'abc-1', false), "cd '/Users/me/shop' && claude --resume abc-1");
  // 폴더 이름의 작은따옴표도 셸에서 깨지지 않게
  assert.equal(resumeCommand("/tmp/it's", 'abc-1', false), "cd '/tmp/it'\\''s' && claude --resume abc-1");
  // Windows(PowerShell): [ ]·$·`·'가 든 폴더도 글자 그대로 가게 -LiteralPath와 작은따옴표
  assert.equal(resumeCommand('C:\\code\\shop', 'abc-1', true), "cd -LiteralPath 'C:\\code\\shop'; claude --resume abc-1");
  assert.equal(resumeCommand("C:\\code\\shop [old] $x `y it's", 'abc-1', true), "cd -LiteralPath 'C:\\code\\shop [old] $x `y it''s'; claude --resume abc-1");
  assert.equal(resumeCommand('', 'abc-1', false), 'claude --resume abc-1');
});

test('토큰 숫자는 만 단위로 줄인다', () => {
  assert.equal(fmtTokens(9876), '9,876');
  assert.equal(fmtTokens(548123), '54.8만');
  assert.equal(fmtTokens(1000000), '100만');
});

test('대화 압축: 자동·내가 요청과 걸린 시간, 쉬는 동안 미리 써 둔 요약', () => {
  assert.equal(compactHow({ trigger: 'auto', ms: 56750 }), '자동 · 57초 걸림');
  assert.equal(compactHow({ trigger: 'manual', ms: 63200 }), '내가 요청 · 1분 3초 걸림');
  assert.equal(compactHow({ trigger: 'auto', ms: 37, idle: true }), '쉬는 동안 미리 써 둔 요약');
  assert.equal(compactHow({ trigger: 'auto' }), '자동'); // 걸린 시간이 없는 옛 기록
});

test('사무실 프로그램이 바뀌면: 서버 쪽은 다시 켜라고, 화면 쪽만이면 새로 고치라고', () => {
  assert.equal(codeNotice(null, 0).kind, '');
  assert.equal(codeNotice({ restart: false, ui: 100 }, 100).kind, '');
  assert.equal(codeNotice({ restart: false, ui: 200 }, 100).kind, 'reload');
  const r = codeNotice({ restart: true, ui: 200 }, 100);
  assert.equal(r.kind, 'restart');
  assert.match(r.text, /끄고 다시 켜야/);
  assert.equal(codeNotice({ restart: false, ui: 200 }, 0).kind, '', '처음 받은 값이 없으면 견줄 수 없다');
});

test('일한 시간: 분, 시간(0분은 빼고), 시간과 분', async () => {
  const { fmtWorked } = await import('../public/js/util.js');
  assert.equal(fmtWorked(45 * 60000), '45분');
  assert.equal(fmtWorked(60 * 60000), '1시간');
  assert.equal(fmtWorked(214 * 60000), '3시간 34분');
  assert.equal(fmtWorked(0), '0분');
});

test('몇 주 전인지: 월요일부터 한 주, 이번 주 0 · 지난 주 -1', async () => {
  const { weekOffset } = await import('../public/js/util.js');
  const thu = new Date(2026, 10, 5, 12).getTime(); // 목요일
  assert.equal(weekOffset(new Date(2026, 10, 2).getTime(), thu), 0); // 이번 주 월요일
  assert.equal(weekOffset(new Date(2026, 10, 1, 23).getTime(), thu), -1); // 어제의 어제(일요일)는 지난 주
  assert.equal(weekOffset(new Date(2026, 9, 26).getTime(), thu), -1);
  assert.equal(weekOffset(new Date(2026, 9, 5).getTime(), thu), -4);
  assert.equal(weekOffset(new Date(2026, 2, 30).getTime(), new Date(2026, 3, 1).getTime()), 0); // 서머타임이 끼어도 (3월 말)
});

test('가운데 안내는 글이 길수록 오래 띄운다 (1.4초~4초)', async () => {
  const { toastMs } = await import('../public/js/util.js');
  assert.ok(toastMs('🛗 2F · blog') < 1500); // 층 옮김처럼 짧은 건 거의 그대로
  assert.equal(toastMs(''), 1400);
  const long = '📋 복사했어요 · 터미널에 붙여 넣으면 이 세션을 이어서 해요';
  assert.ok(toastMs(long) > 2500 && toastMs(long) <= 4000);
  assert.equal(toastMs('가'.repeat(200)), 4000);
});

test('이번 차례를 예약 작업이 시켰는지: ⏰로 시작하면 예약, 내 말·답 마침이면 아님, 인턴 일은 안 본다', async () => {
  const { scheduledAfter } = await import('../public/js/util.js');
  const run = evs => evs.reduce(scheduledAfter, false);
  const sched = { k: 'note', kind: 'schedule' }, me = { k: 'user', text: '고쳐 줘' }, done = { k: 'say', final: true };
  assert.equal(run([sched, { k: 'tool' }, { k: 'think' }]), true); // 예약 작업이 일하는 중
  assert.equal(run([sched, { k: 'user', agent: 'i1' }]), true); // 인턴이 받은 말은 상관없다
  assert.equal(run([sched, me]), false); // 중간에 내가 말을 걸면 내 차례
  assert.equal(run([sched, done]), false); // 답을 마치면 끝
  assert.equal(run([me, { k: 'note', kind: 'task' }]), false); // 백그라운드 알림은 상관없다
  assert.equal(scheduledAfter(true, { k: 'say', final: true, agent: 'i1' }), true); // 인턴이 마친 건 차례 끝이 아니다
});

test("얼마나 지났는지: 반올림해서 단위가 넘어가면 윗단위로 ('60분 전'·'24시간 전'이 아니라)", () => {
  const now = Date.parse('2026-11-15T12:00:00');
  const before = sec => ago(now - sec * 1000, now);
  assert.equal(before(10), '방금');
  assert.equal(before(44), '방금');
  assert.equal(before(45), '1분 전');
  assert.equal(before(12 * 60), '12분 전');
  assert.equal(before(59 * 60 + 40), '1시간 전');
  assert.equal(before(3 * 3600 + 600), '3시간 전');
  assert.equal(before(23 * 3600 + 50 * 60), '1일 전');
  assert.equal(before(2 * 86400), '2일 전');
  assert.equal(before(-30), '방금'); // 시계가 조금 어긋나 앞날이어도
});

test("일한 시간: 조금이라도 일했으면 '0분'이 아니라 '1분 미만', 1시간 0분은 '1시간'", () => {
  assert.equal(fmtWorked(0), '0분');
  assert.equal(fmtWorked(undefined), '0분');
  assert.equal(fmtWorked(20000), '1분 미만');
  assert.equal(fmtWorked(40000), '1분');
  assert.equal(fmtWorked(45 * 60000), '45분');
  assert.equal(fmtWorked(60 * 60000), '1시간');
  assert.equal(fmtWorked(214 * 60000), '3시간 34분');
});

test('창이 떠 있으면 Tab이 창 밖으로 빠져나가지 않는다 (마지막 → 처음, Shift+Tab 처음 → 마지막, 숨긴 버튼은 건너뜀)', async () => {
  const { trapTab } = await import('../public/js/util.js');
  let focused = null;
  const el = (name, shown = true) => ({ name, getClientRects: () => (shown ? [1] : []), focus() { focused = name; globalThis.document.activeElement = this; } });
  const a = el('a'), b = el('b'), hidden = el('hidden', false), c = el('c');
  const box = { querySelectorAll: () => [a, b, hidden, c], contains: x => [a, b, hidden, c].includes(x) };
  const key = (shiftKey = false) => { const e = { key: 'Tab', shiftKey, prevented: false, preventDefault() { e.prevented = true; } }; return e; };
  globalThis.document = { activeElement: c };
  let e = key();
  assert.equal(trapTab(box, e), true);
  assert.equal(focused, 'a');
  assert.ok(e.prevented);
  e = key(true); // a에서 Shift+Tab → 숨긴 것을 건너뛰고 c
  assert.equal(trapTab(box, e), true);
  assert.equal(focused, 'c');
  globalThis.document.activeElement = b; // 가운데에서는 브라우저에 맡긴다
  e = key();
  assert.equal(trapTab(box, e), false);
  assert.equal(e.prevented, false);
  globalThis.document.activeElement = { outside: true }; // 초점이 창 밖이면 창 안으로
  assert.equal(trapTab(box, key()), true);
  assert.equal(focused, 'a');
  assert.equal(trapTab(box, { key: 'Enter' }), false);
  delete globalThis.document;
});

test('화면 밝기 버튼: 컴퓨터 설정 따라가기 → 밝게 → 어둡게 → 다시 따라가기', async () => {
  const { nextTheme, THEMES } = await import('../public/js/util.js');
  assert.deepEqual([nextTheme(''), nextTheme('light'), nextTheme('dark')], ['light', 'dark', '']);
  for (const t of ['', 'light', 'dark']) assert.ok(THEMES[t].icon && THEMES[t].name, t);
});

test("모델 이름: 'claude-opus-5-5' → 'Opus 5.5', 날짜·예전 꼴·[1m]도", async () => {
  const { modelName } = await import('../public/js/util.js');
  assert.equal(modelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelName('claude-opus-5'), 'Opus 5');
  assert.equal(modelName('claude-fable-5-2'), 'Fable 5.2');
  assert.equal(modelName('claude-sonnet-4-5-20250929'), 'Sonnet 4.5');
  assert.equal(modelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(modelName('claude-3-5-sonnet-20241022'), 'Sonnet 3.5');
  assert.equal(modelName('claude-3-opus-20240229'), 'Opus 3');
  assert.equal(modelName('claude-opus-4-6[1m]'), 'Opus 4.6 (1M)');
  assert.equal(modelName('gpt-x'), 'gpt-x'); // 모르는 꼴은 그대로
  assert.equal(modelName(''), '');
  assert.equal(modelName(undefined), '');
});

test('이어 하기 명령의 꼴은 브라우저가 아니라 폴더 경로로: Windows 폴더면 PowerShell, 아니면 sh (WSL의 /home/…도 sh)', () => {
  for (const p of ['C:\\code\\shop', 'd:/work', '\\\\server\\share\\x']) assert.equal(isWinPath(p), true, p);
  for (const p of ['/home/me/shop', '/mnt/c/code', '', 'C:', 'shop\\x', null]) assert.equal(isWinPath(p), false, String(p));
  assert.equal(resumeCommand('/home/me/shop', 'abc-1'), "cd '/home/me/shop' && claude --resume abc-1");
  assert.equal(resumeCommand('C:\\code\\shop', 'abc-1'), "cd -LiteralPath 'C:\\code\\shop'; claude --resume abc-1");
});

test("지금 하는 일을 얼마나 했는지: 한 시간이 넘으면 '2시간 5분째', 하루가 넘으면 '1일 3시간째' (전에는 '347분 12초째')", async () => {
  const { secs } = await import('../public/js/util.js');
  assert.equal(secs(12), '12초째');
  assert.equal(secs(200), '3분 20초째');
  assert.equal(secs(3599), '59분 59초째');
  assert.equal(secs(3600), '1시간째');
  assert.equal(secs(347 * 60 + 12), '5시간 47분째');
  assert.equal(secs(86400 + 3 * 3600 + 59), '1일 3시간째');
  assert.equal(secs(-3), '0초째'); // 시계가 조금 어긋나도
});

test("도구 표지판의 짧은 경과 시간: '12s', '3m 20s', 한 시간이 넘으면 '1h 15m' (전에는 '4523s')", async () => {
  const { signTime } = await import('../public/js/util.js');
  assert.equal(signTime(2), ''); // 금방 끝나는 도구는 비운다
  assert.equal(signTime(12), '12s');
  assert.equal(signTime(200), '3m 20s');
  assert.equal(signTime(4523), '1h 15m');
  assert.equal(signTime(-1), '');
});

test("꺼진 사무실을 다시 켤 때 복사할 글: 플러그인이면 Claude Code에 칠 '/office:open', 아니면 터미널 명령", async () => {
  const { startCopy } = await import('../public/js/util.js');
  assert.deepEqual(startCopy('Claude Code에서 /office:open'), { text: '/office:open', where: 'Claude Code' });
  assert.deepEqual(startCopy('node "/Users/me/claude-office/server.js"'), { text: 'node "/Users/me/claude-office/server.js"', where: '터미널' });
  assert.deepEqual(startCopy('node server.js (받은 폴더에서)'), { text: 'node server.js', where: '터미널' }); // 괄호 설명은 빼고
  assert.deepEqual(startCopy('npx https://github.com/holyrootx/claude-office/archive/refs/heads/main.tar.gz?v=1.17.0'), { text: 'npx https://github.com/holyrootx/claude-office/archive/refs/heads/main.tar.gz?v=1.17.0', where: '터미널' });
});

test('화면 쪽만 바뀌었으면 이 탭을 안 보고 있을 때 알아서 새로 고친다 (다시 보기·데모 중이거나 서버를 다시 켜야 할 때는 아니다)', async () => {
  const { autoReload } = await import('../public/js/util.js');
  assert.equal(autoReload('reload', { hidden: true, viewMode: 'all' }), true);
  assert.equal(autoReload('reload', { hidden: true, viewMode: 'file' }), true);
  assert.equal(autoReload('reload', { hidden: false, viewMode: 'all' }), false); // 보고 있으면 안내만
  assert.equal(autoReload('reload', { hidden: true, viewMode: 'replay' }), false);
  assert.equal(autoReload('reload', { hidden: true, viewMode: 'demo' }), false);
  assert.equal(autoReload('restart', { hidden: true }), false); // 서버를 다시 켜야 하면 새로 고쳐도 소용없다
  assert.equal(autoReload('', { hidden: true }), false);
});

test('한 차례에 걸린 시간: 12초, 4분 12초, 1시간 5분 (1초 안쪽은 비운다)', async () => {
  const { tookText } = await import('../public/js/util.js');
  assert.equal(tookText(12000), '12초');
  assert.equal(tookText(252000), '4분 12초');
  assert.equal(tookText(3900000), '1시간 5분');
  assert.equal(tookText(400), '');
  assert.equal(tookText(undefined), '');
});
