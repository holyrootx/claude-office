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
const { describe } = require('../lib/sessions');
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
