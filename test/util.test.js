// 화면 쪽 작은 도구들(public/js/util.js): 이어 하기 명령, 토큰 숫자 꼴.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

let resumeCommand, fmtTokens, compactHow, codeNotice;
test.before(async () => {
  ({ resumeCommand, fmtTokens, compactHow, codeNotice } = await import('../public/js/util.js'));
});

test('이어 하기 명령: 그 폴더로 가서 claude --resume', () => {
  assert.equal(resumeCommand('/Users/me/shop', 'abc-1', false), "cd '/Users/me/shop' && claude --resume abc-1");
  // 폴더 이름의 작은따옴표도 셸에서 깨지지 않게
  assert.equal(resumeCommand("/tmp/it's", 'abc-1', false), "cd '/tmp/it'\\''s' && claude --resume abc-1");
  assert.equal(resumeCommand('C:\\code\\shop', 'abc-1', true), 'cd "C:\\code\\shop"; claude --resume abc-1');
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
