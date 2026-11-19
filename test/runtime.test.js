// 켜져 있는 사무실과 이야기하는 부분(lib/runtime.js): 요청은 무슨 일이 있어도 끝나야 한다.
// (--stop·--background·hooks가 여기서 기다리다 멈추면 Claude Code나 터미널이 같이 멈춘다)
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { once } = require('events');
const runtime = require('../lib/runtime');

async function serve(handler) {
  const srv = http.createServer(handler).listen(0, '127.0.0.1');
  await once(srv, 'listening');
  return srv;
}
const shut = srv => { if (srv.closeAllConnections) srv.closeAllConnections(); srv.close(); };

test('제대로 답하면 상태 번호와 내용을 준다', async () => {
  const srv = await serve((req, res) => res.end(JSON.stringify({ app: 'claude-office', pid: 1 })));
  try {
    const r = await runtime.request(srv.address().port, 'GET', '/api/health');
    assert.equal(r.status, 200);
    assert.deepEqual(await runtime.health(srv.address().port), { app: 'claude-office', pid: 1 });
  } finally { shut(srv); }
});

test('그 포트의 프로그램이 머리말만 보내고 멈춰도 시간 초과 뒤 null로 끝난다 (전에는 영영 기다렸다)', async () => {
  const srv = await serve((req, res) => { res.writeHead(200); res.write('{"app":"claude-'); });
  try {
    const t0 = Date.now();
    assert.equal(await runtime.request(srv.address().port, 'GET', '/api/health', { timeout: 300 }), null);
    assert.ok(Date.now() - t0 < 3000, `${Date.now() - t0}ms`);
    assert.equal(await runtime.health(srv.address().port), null);
  } finally { shut(srv); }
});

test('답하는 도중 연결이 끊겨도 null로 끝난다', async () => {
  const srv = await serve((req, res) => { res.writeHead(200); res.write('{"app"'); setTimeout(() => res.socket.destroy(), 50); });
  try {
    assert.equal(await runtime.request(srv.address().port, 'GET', '/api/health', { timeout: 2000 }), null);
  } finally { shut(srv); }
});

test('아무도 없는 포트면 null', async () => {
  const srv = await serve(() => {});
  const port = srv.address().port;
  shut(srv);
  await once(srv, 'close');
  assert.equal(await runtime.request(port, 'GET', '/api/health'), null);
});
