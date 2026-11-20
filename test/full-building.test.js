// 빌딩이 꽉 찰 만큼(12명 넘게) 일하는 중이어도, 나를 기다리는(🔐) 세션은 빌딩에 들어온다.
// 빌딩은 최근에 기록이 늘어난 세션부터 12명을 고르는데, 권한을 기다리는 세션은 기록이 멈춰 있어서
// 맨 뒤로 밀려 빠졌다 (화면을 새로 열 때도, 몇 초마다 새 세션을 찾을 때도).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CFG = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-full-'));
process.env.CLAUDE_CONFIG_DIR = CFG;
const { Follower, onHook } = require('../lib/sessions');
test.after(() => fs.rmSync(CFG, { recursive: true, force: true }));

test('최근 세션이 13개여도 권한을 기다리는 세션은 첫 장면에 든다', () => {
  const dir = path.join(CFG, 'projects', '-tmp-full');
  fs.mkdirSync(dir, { recursive: true });
  const sids = [];
  for (let i = 0; i < 13; i++) {
    const sid = `cccccccc-0000-0000-0000-${String(i).padStart(12, '0')}`;
    sids.push(sid);
    const at = Date.now() - (13 - i) * 20000; // 0번이 가장 오래 조용하다 (권한을 기다리느라)
    const f = path.join(dir, sid + '.jsonl');
    fs.writeFileSync(f, JSON.stringify({ type: 'user', uuid: 'u' + i, cwd: '/tmp/full', timestamp: new Date(at).toISOString(), message: { role: 'user', content: '일 ' + i } }) + '\n');
    fs.utimesSync(f, new Date(at), new Date(at));
  }
  onHook({ hook_event_name: 'PermissionRequest', session_id: sids[0], tool_name: 'Bash', tool_input: { command: 'npm publish' } });
  const written = [];
  const f = new Follower({ write: s => written.push(s) }, 'all');
  f.close();
  const hello = JSON.parse(written.find(s => s.startsWith('event: hello')).split('\n').find(l => l.startsWith('data: ')).slice(6));
  const got = hello.sessions.map(s => s.sid);
  assert.equal(got.length, 12);
  assert.ok(got.includes(sids[0]), '권한을 기다리는 세션이 빠졌어요');
  assert.ok(hello.sessions.find(s => s.sid === sids[0]).wait, '기다림도 같이');
  assert.ok(!got.includes(sids[1]), '대신 기다리지 않는 가장 조용한 세션이 빠진다');
});

test('보기 메뉴 목록: 최근 30개 밖으로 밀린 세션도 나를 기다리면(🔐) 남긴다', () => {
  const { listSessions, onHook: hook } = require('../lib/sessions');
  const dir = path.join(CFG, 'projects', '-tmp-list');
  fs.mkdirSync(dir, { recursive: true });
  const sids = [];
  for (let i = 0; i < 45; i++) {
    const sid = `dddddddd-0000-0000-0000-${String(i).padStart(12, '0')}`;
    sids.push(sid);
    const at = Date.now() - (45 - i) * 60000; // 0번이 가장 오래됐다
    const f = path.join(dir, sid + '.jsonl');
    fs.writeFileSync(f, JSON.stringify({ type: 'user', uuid: 'l' + i, cwd: '/tmp/list', timestamp: new Date(at).toISOString(), message: { role: 'user', content: '목록 ' + i } }) + '\n');
    fs.utimesSync(f, new Date(at), new Date(at));
  }
  let list = listSessions();
  assert.ok(!list.some(s => s.id === sids[0]), '기다리지 않으면 밀려난다');
  hook({ hook_event_name: 'PermissionRequest', session_id: sids[0], tool_name: 'Bash', tool_input: { command: 'rm -rf build' } });
  list = listSessions();
  const w = list.find(s => s.id === sids[0]);
  assert.ok(w && w.waiting, '나를 기다리는 세션은 목록에 🔐로 남는다');
});
