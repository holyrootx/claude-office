// 화면 쪽 작은 도구들(public/js/util.js): 이어 하기 명령, 토큰 숫자 꼴.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

let resumeCommand, fmtTokens;
test.before(async () => {
  ({ resumeCommand, fmtTokens } = await import('../public/js/util.js'));
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
