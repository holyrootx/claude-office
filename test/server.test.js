// 서버를 진짜로 띄워서 확인한다: 보안 검사, 빌딩(여러 세션), 서브에이전트(인턴), hooks 권한 대기, 켜기·끄기.
// 임시 CLAUDE_CONFIG_DIR와 실행 정보 파일을 써서 실제 ~/.claude와 켜져 있는 사무실에는 손대지 않는다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFile, execFileSync } = require('child_process');

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

test('다시 보기: 세션 전체를 시간 순으로, 인턴은 출근 소개부터 준다', async () => {
  const r = JSON.parse((await get('/api/replay?file=' + encodeURIComponent(shop))).body);
  assert.equal(r.sid, SHOP);
  assert.equal(r.session.project, 'shop');
  assert.equal(r.session.ctx, undefined);
  assert.equal(r.skipped, 0);
  assert.equal(r.total, r.events.length);
  const ts = r.events.map(e => e.ts);
  assert.deepEqual(ts, ts.slice().sort((a, b) => a - b));
  for (const id of ['done1', 'busy1', 'new2']) {
    const first = r.events.findIndex(e => e.agent === id);
    assert.equal(r.events[first].k, 'agent', id + ' 소개가 먼저');
  }
  assert.ok(r.events.some(e => e.k === 'user' && !e.agent && e.text === '401 고쳐 줘'));
  assert.equal((await get('/api/replay?file=' + encodeURIComponent('/etc/passwd'))).status, 400);
});

test('업무 일지: 오늘 움직인 세션을 프로젝트별로 모은다', async () => {
  const j = JSON.parse((await get('/api/journal')).body);
  const shop = j.projects.find(p => p.project === 'shop');
  assert.ok(shop, 'shop 프로젝트');
  assert.ok(shop.sessions.some(s => s.id === SHOP));
  assert.ok(shop.prompts >= 1);
  assert.ok(shop.tools >= 2); // 메인의 Read + 인턴의 Grep
  assert.ok(shop.interns >= 1);
  assert.ok(shop.rooms.library >= 2);
  assert.ok(shop.tokens >= 300); // 앞에서 쓴 답의 출력 토큰
  assert.equal(j.totals.tokens, j.projects.reduce((n, p) => n + p.tokens, 0));
  assert.ok(!j.projects.some(p => p.sessions.some(s => s.id === OLD)) || fs.statSync(old).mtimeMs >= j.since); // 오늘 안 움직인 세션은 빠진다
  assert.equal(j.totals.projects, j.projects.length);
});

test('업무 일지: 지난 날도 볼 수 있다 (?day=-1, YYYY-MM-DD)', async () => {
  const { dayRange } = require('../lib/sessions');
  const today = dayRange(0), y = dayRange(-1);
  assert.equal(y.until, today.since); // 어제는 오늘 0시에 끝난다
  assert.equal(dayRange('2026-10-31').since, new Date(2026, 9, 31).getTime());
  assert.equal(dayRange('2026-10-31').until, new Date(2026, 10, 1).getTime());
  const now = JSON.parse((await get('/api/journal')).body);
  assert.equal(now.today, true);
  // 테스트 기록은 모두 방금 쓴 것이라 어제 일지에는 없다
  const past = JSON.parse((await get('/api/journal?day=-1')).body);
  assert.equal(past.today, false);
  assert.equal(past.since, y.since);
  assert.ok(!past.projects.some(p => p.sessions.some(x => x.id === SHOP)));
  assert.match(server('--journal', '어제'), /이날은 일한 기록이 없어요/);
});

test('업무 일지를 터미널에도 출력한다 (--journal)', () => {
  const out = server('--journal');
  assert.match(out, /업무 일지/);
  assert.match(out, /\bshop\b/);
  assert.match(out, /일한 시간/);
});

test('일한 시간은 5분보다 짧은 간격만 더한다', () => {
  const { workedMs } = require('../lib/sessions');
  const m = 60000;
  assert.equal(workedMs([0, 1 * m, 3 * m, 20 * m, 21 * m]), 4 * m); // 3분→20분은 쉰 시간
  assert.equal(workedMs([]), 0);
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

test('긴 세션은 화면을 먼저 띄우고, 건너뛴 앞부분의 도구 사용량을 뒤이어 세어 합친다', async () => {
  const P = path.join(CFG, 'projects', '-tmp-big');
  fs.mkdirSync(P, { recursive: true });
  const f = path.join(P, 'big-1.jsonl');
  const pad = 'x'.repeat(250);
  const lines = [];
  for (let i = 0; i < 30000; i++) {
    lines.push(JSON.stringify({ type: 'assistant', uuid: 'big' + i, timestamp: iso(), cwd: '/tmp/big', pad, message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'bt' + i, name: 'Read', input: { file_path: '/a' } }] } }));
  }
  fs.writeFileSync(f, lines.join('\n') + '\n'); // 빌딩이 처음에 읽는 8MB보다 크다
  const s = stream('all');
  const first = await until(() => {
    const h = s.log.find(x => x.ev === 'hello');
    return (h && h.sessions.find(x => x.sid === 'big-1')) || s.log.find(x => x.ev === 'join' && x.sid === 'big-1');
  }, 5000);
  assert.ok(first, '빌딩에 들어옴');
  assert.ok(first.stats.tools < 30000, '처음엔 끝부분만 센다');
  const full = await until(() => s.updates('big-1').find(u => u.stats.tools === 30000), 8000);
  s.close();
  assert.ok(full, '앞부분까지 합쳐 3만 개');
  assert.equal(full.stats.library, 30000);
  // 업무 일지도 오늘 일이 끝부분보다 앞에서 시작했으면 처음부터 읽어서 센다
  const j = JSON.parse((await get('/api/journal')).body);
  assert.equal(j.projects.find(p => p.project === 'big').tools, 30000);
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
  assert.equal(JSON.parse((await get('/api/sessions')).body).activeMinutes, 30); // 화면의 '최근 30분' 글자
  assert.ok(!plain.some(s => s.file === pinned));
  const kept = await list('?keep=' + encodeURIComponent(pinned));
  assert.equal(kept.length, 31);
  assert.equal(kept[30].file, pinned);
  assert.equal((await list('?keep=' + encodeURIComponent('/etc/passwd'))).length, 30); // 기록 폴더 밖은 무시
});

// 사무실을 따로 띄워서 확인하는 것들. 서로 파일·포트가 겹치지 않아서 한꺼번에 돌린다
// ('다음 포트로 연다' 테스트는 빈 포트 번호가 옆 테스트와 겹칠 수 있어서 따로 돌린다)
// (퇴근을 기다리는 테스트가 몇 초씩 걸려서, 차례로 돌리면 전체 테스트가 10초쯤 늘어난다)
test.describe('따로 띄운 사무실', { concurrency: true }, () => {
  test('빌딩: 오래 조용한 직원은 퇴근하고(마지막 한 명은 남김), 다시 움직이면 출근한다', async () => {
    const cfg = path.join(TMP, 'claude-leave');
    const P = path.join(cfg, 'projects', '-tmp-leave');
    fs.mkdirSync(P, { recursive: true });
    const fa = path.join(P, 'leave-a.jsonl'), fb = path.join(P, 'leave-b.jsonl');
    userMsg(fa, '첫 번째');
    await sleep(50);
    userMsg(fb, '두 번째');
    const port = PORT + 7;
    const env = { ...ENV, CLAUDE_CONFIG_DIR: cfg, CLAUDE_OFFICE_RUNTIME: path.join(TMP, 'rt-leave.json'), CLAUDE_OFFICE_ACTIVE_MINUTES: '0.05' }; // 3초
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--port', String(port)], { env, stdio: 'ignore' });
    const log = [];
    let req;
    try {
      assert.ok(await until(() => fs.existsSync(env.CLAUDE_OFFICE_RUNTIME), 4000));
      req = http.get({ host: '127.0.0.1', port, path: '/api/stream?file=all' }, res => {
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
      const hello = await until(() => log.find(x => x.ev === 'hello'));
      assert.equal(hello.sessions.length, 2);
      const left = await until(() => log.find(x => x.ev === 'leave'), 8000);
      assert.equal(left && left.sid, 'leave-a'); // 더 오래 조용한 쪽이 퇴근
      await sleep(2500);
      assert.equal(log.filter(x => x.ev === 'leave').length, 1); // 마지막 한 명은 남는다
      userMsg(fa, '다시 일해요');
      const back = await until(() => log.find(x => x.ev === 'join' && x.sid === 'leave-a'), 4000);
      assert.ok(back, '다시 출근');
    } finally {
      if (req) req.destroy();
      child.kill();
    }
  });

  test('빌딩: 사용 한도가 풀리기를 기다리는 직원은 조용해도 퇴근하지 않는다', async () => {
    const cfg = path.join(TMP, 'claude-limit');
    const P = path.join(cfg, 'projects', '-tmp-limit');
    fs.mkdirSync(P, { recursive: true });
    const fl = path.join(P, 'limit-a.jsonl'), fq = path.join(P, 'quiet-b.jsonl');
    const d = new Date(Date.now() + 2 * 3600 * 1000);
    const clock = `${(d.getHours() % 12) || 12}:${String(d.getMinutes()).padStart(2, '0')}${d.getHours() < 12 ? 'am' : 'pm'}`;
    userMsg(fl, '계속해 줘');
    put(fl, { type: 'assistant', cwd: '/tmp/limit', message: { model: '<synthetic>', content: [{ type: 'text', text: `You've hit your session limit · resets ${clock} (Asia/Seoul)` }] } });
    await sleep(50);
    userMsg(fq, '그냥 조용한 세션');
    const port = PORT + 8;
    const env = { ...ENV, CLAUDE_CONFIG_DIR: cfg, CLAUDE_OFFICE_RUNTIME: path.join(TMP, 'rt-limit.json'), CLAUDE_OFFICE_ACTIVE_MINUTES: '0.05' }; // 3초
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--port', String(port)], { env, stdio: 'ignore' });
    const log = [];
    let req;
    try {
      assert.ok(await until(() => fs.existsSync(env.CLAUDE_OFFICE_RUNTIME), 4000));
      req = http.get({ host: '127.0.0.1', port, path: '/api/stream?file=all' }, res => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', c => {
          buf += c;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const blk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = (blk.match(/^event: (.*)$/m) || [])[1];
            const dd = (blk.match(/^data: (.*)$/m) || [])[1];
            if (ev) log.push({ ev, ...JSON.parse(dd) });
          }
        });
      });
      const hello = await until(() => log.find(x => x.ev === 'hello'));
      assert.equal(hello.sessions.length, 2);
      const left = await until(() => log.find(x => x.ev === 'leave'), 8000);
      assert.equal(left && left.sid, 'quiet-b'); // 더 오래 조용한 limit-a가 아니라 그냥 조용한 쪽이 퇴근
      await sleep(2000);
      assert.ok(!log.some(x => x.ev === 'leave' && x.sid === 'limit-a'));
    } finally {
      if (req) req.destroy();
      child.kill();
    }
  });

  test('뒤에서 켜지 못하면 사무실이 남긴 말을 보여 준다', async () => {
    const busy = http.createServer((q, r) => r.end('다른 프로그램')).listen(0, '127.0.0.1');
    await new Promise(r => busy.once('listening', r));
    const env = { ...ENV, CLAUDE_OFFICE_RUNTIME: path.join(TMP, 'rt-bg-fail.json') };
    // 같이 도는 테스트를 멈추지 않게 기다리는 동안 이벤트 루프를 비워 둔다 (execFileSync 대신)
    const out = await new Promise(resolve => execFile(process.execPath, [path.join(ROOT, 'server.js'), '--background', '--port', String(busy.address().port)], { env }, (e, stdout) => resolve(String(stdout))));
    busy.close();
    assert.match(out, /켜지 못했어요/);
    assert.match(out, /다른 프로그램이 쓰고 있어요/);
  });
});

test('기본 포트를 다른 프로그램이 쓰고 있으면 다음 포트로 연다 (직접 정한 포트는 그대로 실패)', async () => {
  const busy = http.createServer((q, r) => r.end('다른 프로그램')).listen(0, '127.0.0.1');
  await new Promise(r => busy.once('listening', r));
  const D = busy.address().port;
  const env = { ...ENV, CLAUDE_OFFICE_RUNTIME: path.join(TMP, 'rt-fallback.json'), CLAUDE_OFFICE_DEFAULT_PORT: String(D) };
  delete env.PORT;
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env, stdio: 'ignore' });
  try {
    assert.ok(await until(() => fs.existsSync(env.CLAUDE_OFFICE_RUNTIME), 4000), '실행 정보 파일');
    const rt = JSON.parse(fs.readFileSync(env.CLAUDE_OFFICE_RUNTIME, 'utf8'));
    assert.equal(rt.port, D + 1);
    const h = await new Promise(resolve => http.get({ host: '127.0.0.1', port: D + 1, path: '/api/health' }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => resolve(JSON.parse(d)));
    }));
    assert.equal(h.app, 'claude-office');
    // 직접 정한 포트는 다른 데로 옮기지 않는다
    let out = '';
    try { execFileSync(process.execPath, [path.join(ROOT, 'server.js'), '--port', String(D)], { env: { ...env, CLAUDE_OFFICE_RUNTIME: path.join(TMP, 'rt-x.json') } }); } catch (e) { out = String(e.stdout); }
    assert.match(out, /다른 프로그램이 쓰고 있어요/);
  } finally {
    child.kill();
    busy.close();
  }
});

test('하위 폴더로 옮겨 다닌 세션도 시작한 폴더의 층·프로젝트로 묶는다', async () => {
  const f = path.join(PROJ, 'eeeeeeee-5555-0000-0000-000000000001.jsonl');
  try {
    userMsg(f, '프론트 고쳐 줘'); // cwd: /tmp/shop
    put(f, { type: 'assistant', cwd: '/tmp/shop/frontend', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'sub1', name: 'Read', input: { file_path: '/tmp/shop/frontend/a.ts' } }] } });
    const r = JSON.parse((await get('/api/replay?file=' + encodeURIComponent(f))).body);
    assert.equal(r.session.cwd, '/tmp/shop');
    assert.equal(r.session.project, 'shop');
    assert.equal(r.session.here, '/tmp/shop/frontend');
    const list = JSON.parse((await get('/api/sessions')).body).sessions;
    assert.equal(list.find(x => x.file === f).project, 'shop'); // 마지막 줄이 frontend여도
  } finally {
    fs.rmSync(f, { force: true });
  }
});

test('워크트리에서 시작한 세션은 원래 프로젝트 층·이름으로, 이어 하기는 워크트리에서', async () => {
  const wt = '/tmp/shop/.claude/worktrees/fix-login';
  const dir = path.join(CFG, 'projects', wt.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'ffffffff-6666-0000-0000-000000000001.jsonl');
  try {
    put(f, { type: 'user', cwd: wt, message: { role: 'user', content: '로그인 고쳐 줘' } });
    const r = JSON.parse((await get('/api/replay?file=' + encodeURIComponent(f))).body);
    assert.deepEqual([r.session.home, r.session.project, r.session.worktree, r.session.cwd], ['/tmp/shop', 'shop', 'fix-login', wt]);
    const j = JSON.parse((await get('/api/journal')).body);
    const shop = j.projects.find(p => p.project === 'shop');
    assert.ok(shop.sessions.some(x => x.file === f), '업무 일지에서도 shop 프로젝트에 묶인다');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('사용 한도가 풀리기를 기다리는 세션은 30분이 지나도 빌딩에 남고, 풀린 세션은 나간다', async () => {
  const min = m => Date.now() - m * 60000;
  const clock = t => { const d = new Date(t); return `${(d.getHours() % 12) || 12}:${String(d.getMinutes()).padStart(2, '0')}${d.getHours() < 12 ? 'am' : 'pm'}`; };
  const write = (id, resetsAt) => {
    const f = path.join(PROJ, id + '.jsonl');
    const at = t => new Date(t).toISOString();
    fs.writeFileSync(f, [
      { type: 'user', uuid: id + 'u', timestamp: at(min(41)), cwd: '/tmp/shop', message: { role: 'user', content: '계속해 줘' } },
      { type: 'assistant', uuid: id + 'a', timestamp: at(min(40)), cwd: '/tmp/shop', message: { model: '<synthetic>', content: [{ type: 'text', text: `You've hit your session limit · resets ${clock(resetsAt)} (Asia/Seoul)` }] } },
    ].map(o => JSON.stringify(o)).join('\n') + '\n');
    fs.utimesSync(f, new Date(min(40)), new Date(min(40)));
    return f;
  };
  const LIM = 'dddddddd-4444-0000-0000-000000000001';
  const FREE = 'dddddddd-4444-0000-0000-000000000002';
  const files = [write(LIM, Date.now() + 2 * 3600 * 1000), write(FREE, min(20))];
  try {
    const s = stream('all');
    const hello = await until(() => s.log.find(x => x.ev === 'hello'));
    s.close();
    const sids = hello.sessions.map(x => x.sid);
    assert.ok(sids.includes(LIM), '한도가 풀리기를 기다리는 세션은 데려온다');
    assert.ok(!sids.includes(FREE), '이미 풀린 세션은 데려오지 않는다');
    const list = JSON.parse((await get('/api/sessions')).body).sessions;
    assert.ok(list.find(x => x.id === LIM).limitUntil > Date.now()); // 보기 메뉴에 ⏳
    assert.ok(!(list.find(x => x.id === FREE).limitUntil > Date.now()));
  } finally {
    for (const f of files) fs.rmSync(f, { force: true });
  }
});

test('실행 정보 파일이 지워져도 켜져 있는 사무실을 찾고, 몇 초 안에 다시 써 둔다', async () => {
  const before = JSON.parse(fs.readFileSync(ENV.CLAUDE_OFFICE_RUNTIME, 'utf8'));
  fs.unlinkSync(ENV.CLAUDE_OFFICE_RUNTIME);
  // 파일이 없어도 포트에 물어봐서 이미 켜져 있는 걸 안다 (두 번째 사무실을 띄우지 않는다)
  assert.match(server('--background', '--port', String(PORT)), /이미 켜져/);
  assert.ok(await until(() => fs.existsSync(ENV.CLAUDE_OFFICE_RUNTIME), 5000), '다시 써 둔다');
  const after = JSON.parse(fs.readFileSync(ENV.CLAUDE_OFFICE_RUNTIME, 'utf8'));
  assert.deepEqual([after.pid, after.port, after.token], [before.pid, before.port, before.token]);
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
