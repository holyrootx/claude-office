// 기록 폴더에 읽을 수 없는 세션 파일(권한이 바뀐 등)이 하나 섞여 있어도 사무실이 통째로 멈추지 않는다.
// 전에는 그 파일 하나 때문에 세션 목록·업무 일지가 500이었고, 실시간 화면은 첫 장면(hello)이 안 와서 '연결 중…'에 멈췄다.
// (Windows나 root로 돌리면 chmod로 못 읽게 할 수 없어서 건너뛴다)
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const skip = process.platform === 'win32' || (process.getuid && process.getuid() === 0) ? '파일을 못 읽게 만들 수 없는 환경이에요' : false;
const CFG = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-unreadable-'));
process.env.CLAUDE_CONFIG_DIR = CFG;
const { scanSessions, describe, journal, Follower } = require('../lib/sessions');

const DIR = path.join(CFG, 'projects', '-tmp-shop');
const GOOD = path.join(DIR, 'aaaaaaaa-0000-0000-0000-000000000001.jsonl');
const BAD = path.join(DIR, 'bbbbbbbb-0000-0000-0000-000000000002.jsonl');
test.before(() => {
  fs.mkdirSync(DIR, { recursive: true });
  const t = new Date(Date.now() - 60000).toISOString();
  const L = o => JSON.stringify({ cwd: '/tmp/shop', timestamp: t, ...o });
  fs.writeFileSync(GOOD, [
    L({ type: 'user', uuid: 'u1', message: { role: 'user', content: '로그인 고쳐 줘' } }),
    JSON.stringify({ type: 'last-prompt', lastPrompt: '로그인 고쳐 줘' }),
    L({ type: 'assistant', uuid: 'a1', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/tmp/shop/a.ts' } }] } }),
  ].join('\n') + '\n');
  fs.writeFileSync(BAD, L({ type: 'user', uuid: 'u2', message: { role: 'user', content: '못 읽는 세션' } }) + '\n');
  fs.chmodSync(BAD, 0o000);
});
test.after(() => {
  try { fs.chmodSync(BAD, 0o600); } catch { /* 이미 없음 */ }
  fs.rmSync(CFG, { recursive: true, force: true });
});

test('읽을 수 없는 세션 파일이 섞여 있어도 세션 목록·업무 일지·실시간 화면이 뜬다', { skip }, async () => {
  const all = scanSessions();
  assert.equal(all.length, 2);
  // 세션 목록: 못 읽는 세션은 제목 없이, 나머지는 그대로
  const titles = all.map(s => describe(s).title).sort();
  assert.deepEqual(titles, ['(제목 없음)', '로그인 고쳐 줘']);
  // 업무 일지: 못 읽는 세션만 빼고
  const j = await journal(0);
  assert.deepEqual(j.projects.map(p => [p.project, p.tools]), [['shop', 1]]);
  // 실시간 화면: 첫 장면(hello)에 읽을 수 있는 세션이 온다
  const written = [];
  const res = { write: s => written.push(s) };
  const f = new Follower(res, 'all');
  f.close();
  const hello = written.find(s => s.startsWith('event: hello'));
  assert.ok(hello, '첫 장면이 안 왔어요');
  const data = JSON.parse(hello.split('\n').find(l => l.startsWith('data: ')).slice(6));
  assert.deepEqual(data.sessions.map(x => x.sid), ['aaaaaaaa-0000-0000-0000-000000000001']);
});
