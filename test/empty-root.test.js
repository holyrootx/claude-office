// 기록 폴더가 아예 없을 때: 첫 장면(hello)에 그렇다고 실어 보내서, 화면이 빈 폴더와 다르게 알려 준다.
// (Windows에서 사무실을 켰는데 Claude Code는 WSL에서 쓰는 경우처럼, 다른 곳에 기록이 있을 수 있다)
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CFG = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-empty-'));
process.env.CLAUDE_CONFIG_DIR = CFG;
const { Follower } = require('../lib/sessions');
test.after(() => fs.rmSync(CFG, { recursive: true, force: true }));

function hello() {
  const written = [];
  const f = new Follower({ write: s => written.push(s) }, 'all');
  f.close();
  const h = written.find(s => s.startsWith('event: hello'));
  return JSON.parse(h.split('\n').find(l => l.startsWith('data: ')).slice(6));
}

test('기록 폴더가 없으면 rootMissing, 생기면(비어 있어도) 아니다', () => {
  let d = hello();
  assert.equal(d.root, path.join(CFG, 'projects'));
  assert.equal(d.rootMissing, true);
  assert.deepEqual(d.sessions, []);
  fs.mkdirSync(path.join(CFG, 'projects'));
  d = hello();
  assert.equal(d.rootMissing, false);
});
