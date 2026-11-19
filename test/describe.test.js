// 세션 목록의 제목·프로젝트(lib/sessions.js describe)는 기록 끝부분만 읽는다. 마지막 줄이 화면 캡처 결과처럼
// 아주 커도(내 기록에서 3MB까지) 제목과 프로젝트를 찾는지 본다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CFG = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-describe-'));
process.env.CLAUDE_CONFIG_DIR = CFG;
const { describe, activeAt } = require('../lib/sessions');
test.after(() => fs.rmSync(CFG, { recursive: true, force: true }));

test('마지막 줄이 256KB보다 커도 제목과 프로젝트를 찾는다', () => {
  const dir = path.join(CFG, 'projects', '-tmp-shop');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '44444444-0000-0000-0000-000000000001.jsonl');
  const ts = new Date().toISOString();
  const lines = [
    { type: 'user', timestamp: ts, cwd: '/tmp/shop', message: { role: 'user', content: '화면 찍어 줘' } },
    { type: 'custom-title', customTitle: '스크린샷 확인' },
    // 화면 캡처처럼 큰 도구 결과 (600KB)
    { type: 'user', timestamp: ts, cwd: '/tmp/shop', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'image', source: { type: 'base64', data: 'A'.repeat(600 * 1024) } }] }] } },
  ];
  fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  const st = fs.statSync(file);
  const d = describe({ file, mtime: st.mtimeMs, size: st.size, dir: '-tmp-shop' });
  assert.equal(d.title, '스크린샷 확인');
  assert.equal(d.project, 'shop'); // 기록 폴더 이름(-tmp-shop)이 아니라
});

test('마지막으로 움직인 때: 이어 하기(권한 모드 줄)는 방금으로, 장부 줄만 붙은 건 옛 기록 시각 그대로', () => {
  const dir = path.join(CFG, 'projects', '-tmp-shop');
  fs.mkdirSync(dir, { recursive: true });
  const twoDays = new Date(Date.now() - 2 * 86400000).toISOString();
  const base = JSON.stringify({ type: 'user', timestamp: twoDays, cwd: '/tmp/shop', message: { role: 'user', content: '옛날 일' } }) + '\n';
  const at = name => { const file = path.join(dir, name); const st = fs.statSync(file); return activeAt({ file, mtime: st.mtimeMs, size: st.size }); };
  // claude --resume: 시각 없는 permission-mode·session-owner 줄이 붙는다
  fs.writeFileSync(path.join(dir, '55555555-0000-0000-0000-000000000001.jsonl'), base
    + JSON.stringify({ type: 'permission-mode', permissionMode: 'default', sessionId: 's' }) + '\n'
    + JSON.stringify({ type: 'session-owner', accountUuid: 'a', sessionId: 's' }) + '\n');
  assert.ok(at('55555555-0000-0000-0000-000000000001.jsonl') > Date.now() - 60000, '이어 하면 방금 움직인 걸로');
  // 데스크톱 앱이 붙이는 장부 줄만: 옛 시각 그대로
  fs.writeFileSync(path.join(dir, '55555555-0000-0000-0000-000000000002.jsonl'), base
    + JSON.stringify({ type: 'artifact-autoreact-ledger', v: 1, sessionId: 's', artifacts: [] }) + '\n');
  assert.ok(at('55555555-0000-0000-0000-000000000002.jsonl') < Date.now() - 86400000, '장부 줄만이면 옛 시각');
  // 이어 한 뒤 다시 말을 했으면 그 말의 시각
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(dir, '55555555-0000-0000-0000-000000000003.jsonl'), base
    + JSON.stringify({ type: 'permission-mode', permissionMode: 'default', sessionId: 's' }) + '\n'
    + JSON.stringify({ type: 'user', timestamp: now, cwd: '/tmp/shop', message: { role: 'user', content: '다시 시작' } }) + '\n');
  assert.equal(at('55555555-0000-0000-0000-000000000003.jsonl'), Math.min(Date.parse(now), fs.statSync(path.join(dir, '55555555-0000-0000-0000-000000000003.jsonl')).mtimeMs));
});
