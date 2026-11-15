// hooks/notify.js는 실행 정보 파일이 가리키는 서버가 정말 그 사무실일 때만 알린다.
// 사무실이 강제로 꺼져 파일이 남았는데 그 포트를 다른 프로그램이 쓰면, 명령 내용과 토큰을 그쪽에 보내면 안 된다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-notify-'));
const RT = path.join(TMP, 'runtime.json');
const NOTIFY = path.join(__dirname, '..', 'hooks', 'notify.js');
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// health에 대답하는 가짜 서버: 받은 /hook 요청을 모아 둔다
function fake(healthBody) {
  const hooks = [];
  const srv = http.createServer((req, res) => {
    if (req.url === '/api/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(healthBody)); }
    let b = '';
    req.on('data', c => { b += c; });
    req.on('end', () => { hooks.push({ url: req.url, token: req.headers['x-office-token'], body: b }); res.writeHead(204); res.end(); });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, hooks, port: srv.address().port })));
}
const notify = h => new Promise(r => {
  const c = execFile(process.execPath, [NOTIFY], { env: { ...process.env, CLAUDE_OFFICE_RUNTIME: RT } }, () => r());
  c.stdin.end(JSON.stringify(h));
});
const H = { session_id: 's1', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'cat ~/.ssh/config' } };

test('그 포트의 서버가 바로 그 사무실(같은 pid)이면 알린다', async () => {
  const f = await fake({ app: 'claude-office', version: '9.9.9', pid: process.pid });
  fs.writeFileSync(RT, JSON.stringify({ port: f.port, token: 'secret', pid: process.pid, version: '9.9.9' }));
  await notify(H);
  f.srv.close();
  assert.equal(f.hooks.length, 1);
  assert.equal(f.hooks[0].token, 'secret');
});

test('사무실이 꺼져 파일만 남았고 그 포트를 다른 프로그램이 쓰면 아무것도 보내지 않는다', async () => {
  const other = await fake({ hello: 'world' }); // 사무실이 아닌 서버
  fs.writeFileSync(RT, JSON.stringify({ port: other.port, token: 'secret', pid: process.pid, version: '9.9.9' }));
  await notify(H);
  const imposter = await fake({ app: 'claude-office', pid: 1 }); // 다른 사무실(pid가 다르다)
  fs.writeFileSync(RT, JSON.stringify({ port: imposter.port, token: 'secret', pid: process.pid, version: '9.9.9' }));
  await notify(H);
  const dead = await fake({ app: 'claude-office', pid: 999999 });
  fs.writeFileSync(RT, JSON.stringify({ port: dead.port, token: 'secret', pid: 999999, version: '9.9.9' })); // 그 pid는 없다
  await notify(H);
  for (const f of [other, imposter, dead]) f.srv.close();
  assert.deepEqual([other.hooks.length, imposter.hooks.length, dead.hooks.length], [0, 0, 0]);
});
