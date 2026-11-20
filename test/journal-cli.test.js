// 터미널 업무 일지(--journal): 기록 폴더가 아예 없으면 '일한 기록이 없어요'만이 아니라 그렇다고 알려 준다
// (화면의 첫 안내와 같은 말. 다른 곳(WSL 등)에서 claude를 쓰는 걸 모르고 지나치지 않게). 마크다운은 그대로 붙여 넣게 stderr로.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SERVER = path.join(__dirname, '..', 'server.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-jcli-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const run = (...a) => spawnSync(process.execPath, [SERVER, ...a], { env: { ...process.env, CLAUDE_CONFIG_DIR: TMP }, encoding: 'utf8', timeout: 20000 });

test('기록 폴더가 없으면 stderr로 알려 주고, 마크다운(stdout)은 그대로', () => {
  let r = run('--journal');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /오늘은 아직 일한 기록이 없어요/);
  assert.match(r.stderr, /세션 기록 폴더가 아직 없어요: .*projects[\s\S]*WSL, 다른 계정, CLAUDE_CONFIG_DIR/);
  r = run('--journal', '지난', '주', '--md');
  assert.match(r.stdout, /^## .+ 주간 업무 일지\n\n이 주에는 일한 기록이 없어요/);
  assert.doesNotMatch(r.stdout, /기록 폴더/);
  assert.match(r.stderr, /세션 기록 폴더가 아직 없어요/);
  // 폴더가 생기면(비어 있어도) 그 말은 없다
  fs.mkdirSync(path.join(TMP, 'projects'));
  r = run('--journal', '이번', '달');
  assert.equal(r.stderr, '');
});
