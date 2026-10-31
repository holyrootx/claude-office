// 서버를 진짜로 띄워서 확인한다: 보안 검사, 빌딩(여러 세션), 서브에이전트(인턴), hooks 권한 대기, 켜기·끄기.
// 임시 CLAUDE_CONFIG_DIR와 실행 정보 파일을 써서 실제 ~/.claude와 켜져 있는 사무실에는 손대지 않는다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-test-'));
const CFG = path.join(TMP, 'claude');
const PROJ = path.join(CFG, 'projects', '-tmp-shop');
const PROJ2 = path.join(CFG, 'projects', '-tmp-blog');
const PORT = 40000 + Math.floor(Math.random() * 20000);
const ENV = { ...process.env, CLAUDE_CONFIG_DIR: CFG, CLAUDE_OFFICE_RUNTIME: path.join(TMP, 'runtime.json'), NO_OPEN: '1' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let u = 0;
const iso = () => new Date().toISOString();
const put = (file, o) => fs.appendFileSync(file, JSON.stringify({ uuid: 'u' + ++u, timestamp: iso(), ...o }) + '\n');
const userMsg = (file, text, extra = {}) => put(file, { type: 'user', cwd: path.dirname(file).includes('blog') ? '/tmp/blog' : '/tmp/shop', message: { role: 'user', content: text }, ...extra });
const toolUse = (file, id, name, input, extra = {}) => put(file, { type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name, input }] }, ...extra });
const toolResult = (file, id, isError, extra = {}) => put(file, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: isError ? "The user doesn't want to proceed" : 'ok', is_error: !!isError }] }, ...extra });
const finalSay = (file, text, extra = {}) => put(file, { type: 'assistant', message: { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }] }, ...extra });
const hook = h => execFileSync(process.execPath, [path.join(ROOT, 'hooks', 'notify.js')], { input: JSON.stringify(h), env: ENV });
const server = (...args) => execFileSync(process.execPath, [path.join(ROOT, 'server.js'), ...args], { env: ENV }).toString();

function get(pathname, headers = {}) {
  return new Promise(resolve => {
    http.get({ host: '127.0.0.1', port: PORT, path: pathname, headers }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', () => resolve({ status: 0, body: '' }));
  });
}

// SSE를 받아 이벤트를 차례로 모은다
function stream(want = 'all') {
  const log = [];
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/stream?file=' + encodeURIComponent(want) }, res => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', c => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const blk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = (blk.match(/^event: (.*)$/m) || [])[1];
        const d = (blk.match(/^data: (.*)$/m) || [])[1];
        if (ev) log.push({ ev, ...JSON.parse(d) });
      }
    });
  });
  const updates = sid => log.filter(x => x.ev === 'events').flatMap(x => x.updates).filter(x => !sid || x.sid === sid);
  return {
    log,
    updates,
    lastWait: sid => { const us = updates(sid).filter(x => 'wait' in x); return us.length ? us[us.length - 1].wait : undefined; },
    close: () => req.destroy(),
  };
}

async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(100);
  }
  return fn();
}

const SHOP = 'aaaaaaaa-1111-0000-0000-000000000001';
const BLOG = 'bbbbbbbb-2222-0000-0000-000000000002';
const OLD = 'cccccccc-3333-0000-0000-000000000003';
const shop = path.join(PROJ, SHOP + '.jsonl');
const blog = path.join(PROJ2, BLOG + '.jsonl');
const old = path.join(PROJ, OLD + '.jsonl');
const subDir = path.join(PROJ, SHOP, 'subagents');
let srv;

test.before(async () => {
  fs.mkdirSync(PROJ, { recursive: true });
  fs.mkdirSync(PROJ2, { recursive: true });
  userMsg(old, '옛날 세션');
  const hourAgo = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(old, hourAgo, hourAgo);
  userMsg(blog, '글 써 줘');
  toolUse(blog, 'b1', 'WebSearch', { query: 'SSE' });
  userMsg(shop, '401 고쳐 줘');
  put(shop, { type: 'assistant', message: { model: 'claude-opus-5-5', usage: { input_tokens: 10, cache_creation_input_tokens: 5000, cache_read_input_tokens: 120000, output_tokens: 300 }, content: [{ type: 'text', text: '살펴볼게요' }] } });
  toolUse(shop, 's1', 'Read', { file_path: '/tmp/shop/auth.ts' });
  toolResult(shop, 's1');
  // 이미 끝난 인턴과 아직 일하는 인턴
  fs.mkdirSync(subDir, { recursive: true });
  const done = path.join(subDir, 'agent-done1.jsonl');
  userMsg(done, '조사해', { isSidechain: true, agentId: 'done1' });
  finalSay(done, '끝', { isSidechain: true, agentId: 'done1' });
  const busy = path.join(subDir, 'agent-busy1.jsonl');
  fs.writeFileSync(path.join(subDir, 'agent-busy1.meta.json'), JSON.stringify({ agentType: 'Explore', description: '코드 조사', toolUseId: 's0' }));
  userMsg(busy, '찾아 줘', { isSidechain: true, agentId: 'busy1' });
  toolUse(busy, 'k1', 'Grep', { pattern: 'verifyToken' }, { isSidechain: true, agentId: 'busy1' });

  srv = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--port', String(PORT)], { env: ENV, stdio: 'ignore' });
  for (let i = 0; i < 50 && (await get('/api/health')).status !== 200; i++) await sleep(100);
  assert.ok(await until(() => fs.existsSync(ENV.CLAUDE_OFFICE_RUNTIME), 3000), '서버가 켜졌다');
});

test.after(() => {
  if (srv && srv.exitCode === null) srv.kill();
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('보안: 잘못된 주소·다른 사이트 주소·폴더 밖 파일·토큰 없는 hook을 막는다', async () => {
  assert.equal((await get('/%E0%A4%A')).status, 400);
  assert.equal((await get('/api/sessions', { Host: 'evil.example.com' })).status, 403);
  assert.equal((await get('/..%2fserver.js')).status, 403);
  const r = await new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: '/hook' }, res => resolve(res.statusCode));
    req.end('{}');
  });
  assert.equal(r, 403);
  assert.equal((await get('/')).status, 200); // 그래도 서버는 살아 있다
});

test('빌딩: 최근 30분 안에 움직인 세션만, 일하는 인턴과 함께 보낸다', async () => {
  const s = stream('all');
  const hello = await until(() => s.log.find(x => x.ev === 'hello'));
  s.close();
  assert.equal(hello.mode, 'all');
  const sids = hello.sessions.map(x => x.sid).sort();
  assert.deepEqual(sids, [SHOP, BLOG].sort());
  const snap = hello.sessions.find(x => x.sid === SHOP);
  assert.equal(snap.session.project, 'shop');
  assert.deepEqual(snap.agents.map(a => [a.id, a.type, a.desc]), [['busy1', 'Explore', '코드 조사']]); // 끝난 인턴은 빠진다
  assert.ok(snap.agents[0].history.every(e => e.agent === 'busy1'));
  assert.equal(snap.stats.tools, 2); // 인턴이 쓴 도구까지 합친다
  assert.deepEqual(snap.session.ctx, { tokens: 125010, window: 1000000 }); // 컨텍스트 크기
});

test('자동 모드는 가장 최근 세션 하나만 따라간다', async () => {
  const s = stream('auto');
  const hello = await until(() => s.log.find(x => x.ev === 'hello'));
  s.close();
  assert.equal(hello.mode, 'auto');
  assert.deepEqual(hello.sessions.map(x => x.sid), [SHOP]);
});

test('새 인턴이 생기면 소개 이벤트 뒤에 그 인턴이 한 일을 붙여 보낸다', async () => {
  const s = stream('all');
  await until(() => s.log.find(x => x.ev === 'hello'));
  const f = path.join(subDir, 'agent-new2.jsonl');
  fs.writeFileSync(path.join(subDir, 'agent-new2.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: '문서 확인', toolUseId: 's9' }));
  userMsg(f, '확인해 줘', { isSidechain: true, agentId: 'new2' });
  toolUse(f, 'n1', 'Read', { file_path: '/tmp/shop/README.md' }, { isSidechain: true, agentId: 'new2' });
  const intro = await until(() => s.updates(SHOP).flatMap(x => x.events).find(e => e.k === 'agent' && e.agent === 'new2'), 4000);
  assert.ok(intro, '소개 이벤트');
  assert.equal(intro.type, 'general-purpose');
  assert.equal(intro.parent, 's9');
  toolResult(f, 'n1', false, { isSidechain: true, agentId: 'new2' });
  finalSay(f, '문서는 최신이에요', { isSidechain: true, agentId: 'new2' });
  const fin = await until(() => s.updates(SHOP).flatMap(x => x.events).find(e => e.agent === 'new2' && e.k === 'say' && e.final));
  s.close();
  assert.ok(fin, '인턴의 마지막 보고');
});

test('빌딩에 새 세션이 들어오면 join으로 알린다', async () => {
  const s = stream('all');
  await until(() => s.log.find(x => x.ev === 'hello'));
  const NEW = 'dddddddd-4444-0000-0000-000000000004';
  userMsg(path.join(PROJ2, NEW + '.jsonl'), '새 일');
  const join = await until(() => s.log.find(x => x.ev === 'join' && x.sid === NEW), 4000);
  s.close();
  assert.ok(join);
});

test('권한 대기: hook으로 받아 도구에 붙이고, 결과가 나면 푼다', async () => {
  const s = stream('all');
  await until(() => s.log.find(x => x.ev === 'hello'));
  toolUse(shop, 's2', 'Bash', { command: 'git push', description: '푸시' });
  await sleep(400);
  hook({ session_id: SHOP, transcript_path: shop, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'git push', description: '푸시' } });
  const w = await until(() => s.lastWait(SHOP));
  assert.equal(w.id, 's2');
  assert.equal(w.on, '');
  assert.equal(w.label, '푸시');
  const list = JSON.parse((await get('/api/sessions')).body).sessions;
  assert.equal(list.find(x => x.id === SHOP).waiting, true);
  toolResult(shop, 's2', true); // 거절
  assert.equal(await until(() => s.lastWait(SHOP) === null), true);
  s.close();
});

test('인턴의 권한 대기는 그 인턴에게 붙고, 인턴의 결과로 풀린다', async () => {
  const s = stream('all');
  await until(() => s.log.find(x => x.ev === 'hello'));
  const busy = path.join(subDir, 'agent-busy1.jsonl');
  toolUse(busy, 'k2', 'WebFetch', { url: 'https://example.com/x' }, { isSidechain: true, agentId: 'busy1' });
  await sleep(400);
  hook({ session_id: SHOP, transcript_path: shop, hook_event_name: 'PermissionRequest', agent_id: 'busy1', tool_name: 'WebFetch', tool_input: { url: 'https://example.com/x' } });
  const w = await until(() => s.lastWait(SHOP));
  assert.equal(w.on, 'busy1');
  assert.equal(w.id, 'k2');
  userMsg(shop, '메인 쪽 새 메시지'); // 메인이 움직여도 인턴의 대기는 그대로
  await sleep(600);
  assert.notEqual(s.lastWait(SHOP), null);
  toolResult(busy, 'k2', false, { isSidechain: true, agentId: 'busy1' });
  assert.equal(await until(() => s.lastWait(SHOP) === null), true);
  s.close();
});

test('보고 있지 않던 세션이 권한을 기다리면 빌딩에 데려온다', async () => {
  const hourAgo = new Date(Date.now() - 3600 * 1000);
  toolUse(old, 'o1', 'Edit', { file_path: '/tmp/shop/x.ts' });
  fs.utimesSync(old, hourAgo, hourAgo);
  const s = stream('all');
  const hello = await until(() => s.log.find(x => x.ev === 'hello'));
  assert.ok(!hello.sessions.some(x => x.sid === OLD));
  hook({ session_id: OLD, transcript_path: old, hook_event_name: 'PermissionRequest', tool_name: 'Edit', tool_input: { file_path: '/tmp/shop/x.ts' } });
  const join = await until(() => s.log.find(x => x.ev === 'join' && x.sid === OLD));
  assert.ok(join);
  assert.equal(join.wait.id, 'o1');
  hook({ session_id: OLD, transcript_path: old, hook_event_name: 'SessionEnd', reason: 'other' });
  assert.equal(await until(() => s.lastWait(OLD) === null), true);
  s.close();
});

test('세션 목록: 30개 밖으로 밀린 세션도 화면이 고정해 두었으면(keep) 함께 준다', async () => {
  const P = path.join(CFG, 'projects', '-tmp-many');
  fs.mkdirSync(P, { recursive: true });
  const ago = h => new Date(Date.now() - h * 3600 * 1000);
  for (let i = 0; i < 31; i++) {
    const f = path.join(P, `many-${String(i).padStart(2, '0')}.jsonl`);
    userMsg(f, '세션 ' + i);
    fs.utimesSync(f, ago(2), ago(2));
  }
  const pinned = path.join(P, 'pinned-old.jsonl');
  userMsg(pinned, '고정해 둔 옛 세션');
  fs.utimesSync(pinned, ago(3), ago(3));
  const list = async q => JSON.parse((await get('/api/sessions' + q)).body).sessions;
  const plain = await list('');
  assert.equal(plain.length, 30);
  assert.ok(!plain.some(s => s.file === pinned));
  const kept = await list('?keep=' + encodeURIComponent(pinned));
  assert.equal(kept.length, 31);
  assert.equal(kept[30].file, pinned);
  assert.equal((await list('?keep=' + encodeURIComponent('/etc/passwd'))).length, 30); // 기록 폴더 밖은 무시
});

test('켜기·끄기: 같은 포트로 다시 켜면 이미 켜져 있다고 하고, --stop으로 끈다', async () => {
  assert.match(server('--port', String(PORT)), /이미 켜져/);
  assert.match(server('--stop'), /껐어요/);
  await until(() => srv.exitCode !== null, 3000);
  assert.equal(srv.exitCode, 0);
  assert.ok(!fs.existsSync(ENV.CLAUDE_OFFICE_RUNTIME), '실행 정보 파일을 지운다');
  assert.match(server('--background', '--port', String(PORT)), /뒤에서 켰어요/);
  assert.match(server('--background'), /이미 켜져/);
  assert.match(server('--stop'), /껐어요/);
  assert.match(server('--stop'), /없어요/);
  const t0 = Date.now();
  hook({ session_id: SHOP, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: {} });
  assert.ok(Date.now() - t0 < 1500, '꺼져 있으면 hook은 바로 끝난다');
});
