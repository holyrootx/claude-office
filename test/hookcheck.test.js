// 켤 때 hooks가 켜져 있는지 보는 것: 꺼짐·켜짐(직접·플러그인)·빠진 hook·옮긴 폴더
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hooksStatus } = require('../lib/hookcheck');

const WANT = ['PermissionRequest', 'Notification', 'PreCompact', 'SessionEnd'];
const there = () => true;
const entry = cmd => [{ hooks: [typeof cmd === 'string' ? { type: 'command', command: cmd } : cmd] }];
const printed = (names, file = '/Users/me/claude office/hooks/notify.js') =>
  ({ hooks: Object.fromEntries(names.map(n => [n, entry({ type: 'command', command: 'node', args: [file], async: true })])) });

test('hooks도 플러그인도 없으면 꺼져 있다', () => {
  assert.equal(hooksStatus({ settings: {}, want: WANT, exists: there }).state, 'off');
  assert.equal(hooksStatus({ settings: { hooks: { Stop: entry('say done') } }, want: WANT, exists: there }).state, 'off');
});

test('플러그인으로 켰거나 --print-hooks 내용을 다 합쳤으면 켜져 있다', () => {
  assert.equal(hooksStatus({ settings: { enabledPlugins: { 'office@claude-office': true } }, want: WANT, exists: there }).state, 'on');
  assert.equal(hooksStatus({ settings: { enabledPlugins: { 'office@claude-office': false } }, want: WANT, exists: there }).state, 'off');
  assert.equal(hooksStatus({ settings: {}, want: WANT, plugin: true }).state, 'on');
  assert.equal(hooksStatus({ settings: printed(WANT), want: WANT, exists: there }).state, 'on');
});

test('예전에 합친 설정이면 새로 생긴 hook이 빠졌다고 알려 준다', () => {
  const st = hooksStatus({ settings: printed(['PermissionRequest', 'Notification', 'SessionEnd']), want: WANT, exists: there });
  assert.deepEqual([st.state, st.missing], ['stale', ['PreCompact']]);
});

test('명령 한 줄로 적은 hook도 알아보고, 가리키는 파일이 없으면 옮겼다고 본다', () => {
  const seen = [];
  const exists = f => { seen.push(f); return !f.includes('old'); };
  const one = { hooks: Object.fromEntries(WANT.map(n => [n, entry('node "/Users/me/old place/hooks/notify.js"')])) };
  const st = hooksStatus({ settings: one, want: WANT, exists });
  assert.deepEqual([st.state, st.file], ['moved', '/Users/me/old place/hooks/notify.js']);
  // ~와 $HOME은 풀어서 보고, 다른 환경 변수가 든 경로는 있다고 본다
  const home = { hooks: Object.fromEntries(WANT.map(n => [n, entry('node ~/claude-office/hooks/notify.js')])) };
  seen.length = 0;
  assert.equal(hooksStatus({ settings: home, want: WANT, exists }).state, 'on');
  assert.ok(seen[0].startsWith(require('os').homedir()));
  const plug = printed(WANT, '${CLAUDE_PLUGIN_ROOT}/hooks/notify.js');
  assert.equal(hooksStatus({ settings: plug, want: WANT, exists: () => false }).state, 'on');
});
