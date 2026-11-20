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
// 서버·hook을 실행하고 끝나기를 기다릴 때는 시간 제한을 둔다. 테스트 서버가 꺼진 채로 'server.js --port …'를 부르면
// '이미 켜져 있어요' 대신 새 사무실이 켜져서 끝나지 않고, 테스트 전체가 실패 없이 몇십 분씩 멈춰 있었다
const LIMIT = 20000;
const hook = h => execFileSync(process.execPath, [path.join(ROOT, 'hooks', 'notify.js')], { input: JSON.stringify(h), env: ENV, timeout: LIMIT });
function server(...args) {
  try {
    return execFileSync(process.execPath, [path.join(ROOT, 'server.js'), ...args], { env: ENV, timeout: LIMIT }).toString();
  } catch (e) {
    if (e.code !== 'ETIMEDOUT') throw e;
    const dead = srv && srv.exitCode !== null ? ` 테스트 서버가 꺼져 있어요(종료 코드 ${srv.exitCode}, 신호 ${srv.signalCode}).` : '';
    throw new Error(`server.js ${args.join(' ')}가 ${LIMIT / 1000}초 안에 끝나지 않았어요.${dead}`);
  }
}

function get(pathname, headers = {}) {
  return new Promise(resolve => {
    http.get({ host: '127.0.0.1', port: PORT, path: pathname, headers }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d, headers: res.headers }));
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
    lastCompact: sid => { const us = updates(sid).filter(x => 'compacting' in x); return us.length ? us[us.length - 1].compacting : undefined; },
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
let srvAt = 0; // 테스트 서버를 띄운 시각 (아래 '서버 쪽 파일이 바뀌면' 테스트가 실패할 때 보여 준다)
let fixtureHour = 0; // 처음 기록(도구)을 쓴 시간대: 확인할 때의 시각으로 보면 정각을 넘길 때(22:59 → 23:00) 엇갈린다

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

  fixtureHour = new Date().getHours();
  srv = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--port', String(PORT)], { env: ENV, stdio: 'ignore' });
  srvAt = Date.now();
  for (let i = 0; i < 50 && (await get('/api/health')).status !== 200; i++) await sleep(100);
  assert.ok(await until(() => fs.existsSync(ENV.CLAUDE_OFFICE_RUNTIME), 3000), '서버가 켜졌다');
  // 그 포트에 다른 서버(전에 남은 테스트 서버 등)가 떠 있으면 엉뚱한 서버와 이야기하게 된다: 우리가 띄운 서버인지 확인
  assert.equal(JSON.parse((await get('/api/health')).body).pid, srv.pid, `${PORT} 포트에 이 테스트가 띄우지 않은 서버가 떠 있어요`);
});

// 테스트가 중간에 실패해서 --background로 켠 사무실이 남았으면 그것도 끈다 (이 테스트의 실행 정보 파일에 적힌 것만)
function stopLeftover() {
  try {
    const { pid } = JSON.parse(fs.readFileSync(ENV.CLAUDE_OFFICE_RUNTIME, 'utf8'));
    if (pid && pid !== process.pid && (!srv || pid !== srv.pid)) process.kill(pid);
  } catch { /* 없으면 그만 */ }
}
test.after(() => {
  if (srv && srv.exitCode === null) srv.kill();
  stopLeftover();
  fs.rmSync(TMP, { recursive: true, force: true });
});
// 테스트를 Ctrl+C나 kill로 중간에 끊어도 띄워 둔 사무실 서버가 남지 않게 (남으면 며칠씩 혼자 돈다)
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(sig, () => {
    if (srv && srv.exitCode === null) srv.kill();
    stopLeftover();
    fs.rmSync(TMP, { recursive: true, force: true });
    process.exit(130);
  });
}

test('보안: 잘못된 주소·다른 사이트 주소·폴더 밖 파일·토큰 없는 hook을 막는다', async () => {
  assert.equal((await get('/%E0%A4%A')).status, 400);
  assert.equal((await get('/api/sessions', { Host: 'evil.example.com' })).status, 403);
  assert.equal((await get('/..%2fserver.js')).status, 403);
  // 파일 이름에 NUL이 든 주소: 전에는 fs가 바로 오류를 던져서 이 요청 하나로 서버가 꺼졌다 (다른 사이트의 그림 태그로도 부를 수 있다)
  for (const p of ['/%00', '/js/%00.js', '/index.html%00']) assert.equal((await get(p)).status, 400, p);
  assert.equal((await get('/api/health')).status, 200);
  const r = await new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: '/hook' }, res => resolve(res.statusCode));
    req.end('{}');
  });
  assert.equal(r, 403);
  assert.equal((await get('/')).status, 200); // 그래도 서버는 살아 있다
});

test('보안: 다른 사이트의 페이지가 브라우저로 보낸 요청(그림 태그·fetch·iframe)은 받지 않고, 링크로 화면을 여는 건 받는다', async () => {
  const from = (site, mode, dest) => ({ 'Sec-Fetch-Site': site, 'Sec-Fetch-Mode': mode, 'Sec-Fetch-Dest': dest });
  // 전에는 다른 사이트의 <img src="http://localhost:4777/api/stream">이 실시간 연결을 열어 두고, 월간 일지를 몇 년 치 훑게 할 수 있었다
  for (const [p, h] of [
    ['/api/journal?month=-1', from('cross-site', 'no-cors', 'image')],
    ['/api/sessions', from('cross-site', 'cors', 'empty')],
    ['/api/health', from('same-site', 'cors', 'empty')], // 다른 포트의 localhost 페이지
    ['/', from('cross-site', 'navigate', 'iframe')],
    ['/api/stream', from('cross-site', 'no-cors', 'image')],
  ]) assert.equal((await get(p, h)).status, 403, `${p} ${JSON.stringify(h)}`);
  // 받는 것: 링크를 눌러 화면 열기, 주소창에 쳐서 열기, 화면이 스스로 부르는 API, 머리글 없는 hook·명령
  assert.equal((await get('/', from('cross-site', 'navigate', 'document'))).status, 200);
  assert.equal((await get('/', from('none', 'navigate', 'document'))).status, 200);
  assert.equal((await get('/api/sessions', from('same-origin', 'cors', 'empty'))).status, 200);
  assert.equal((await get('/api/health')).status, 200);
});

test('보안: 마크다운 일지·JSON·오류 글은 주소에 적은 글이 들어 있어도 문서로 열려 스크립트가 돌지 않는다', async () => {
  const evil = encodeURIComponent('<script>alert(1)</script>');
  for (const p of [`/api/journal?day=0&format=md&project=${evil}`, `/api/journal?week=0&format=md&project=${evil}`, `/api/journal?day=0&project=${evil}`, '/api/sessions', '/api/replay', '/nothing']) {
    const r = await get(p);
    assert.equal(r.headers['x-content-type-options'], 'nosniff', p);
    assert.match(r.headers['content-security-policy'] || '', /default-src 'none'.*sandbox/, p);
  }
  // 화면은 그대로 자기 CSP (스크립트 파일은 돌아야 하니까)
  assert.match((await get('/')).headers['content-security-policy'], /script-src 'self'/);
});

test('보안: 화면에는 이 서버의 스크립트 파일만 돌게 하는 CSP를 붙이고, 페이지 안에 직접 쓴 스크립트는 없다', async () => {
  const r = await get('/');
  const csp = r.headers['content-security-policy'] || '';
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  // <script>는 모두 src로 불러온다 (안에 직접 쓴 스크립트는 CSP가 막으니까)
  assert.deepEqual((r.body.match(/<script\b[^>]*>/g) || []).filter(t => !/\bsrc=/.test(t)), []);
  assert.doesNotMatch(r.body, /\son[a-z]+=/i); // onclick= 같은 것도 없다
});

test('켜 둔 사이에 서버 쪽 파일이 바뀌면 세션 목록에 다시 켜라고 실어 보낸다', async () => {
  const code = () => get('/api/sessions').then(r => JSON.parse(r.body).code);
  // 가끔(파일을 고친 직후) 첫 확인에서 restart가 true로 와서 실패한 적이 있다. 다시 나면 원인이 보이게:
  // 서버를 띄운 시각과 가장 최근에 고친 서버 쪽 파일 셋을 같이 남긴다
  const why = () => {
    const files = [path.join(ROOT, 'server.js'), path.join(ROOT, 'package.json'), ...fs.readdirSync(path.join(ROOT, 'lib')).map(f => path.join(ROOT, 'lib', f))];
    const top = files.map(f => [path.relative(ROOT, f), Math.round(fs.statSync(f).mtimeMs - srvAt)]).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return `서버를 띄운 뒤 몇 ms에 고쳤는지: ${JSON.stringify(top)}`;
  };
  const before = await code();
  assert.equal(before.restart, false, why());
  assert.ok(before.ui > 0);
  // 파일 내용은 그대로 두고 고친 시각만 잠깐 미래로 (git pull로 바뀐 것처럼)
  const f = path.join(ROOT, 'lib', 'config.js');
  const st = fs.statSync(f);
  try {
    fs.utimesSync(f, st.atime, new Date(Date.now() + 60000));
    assert.equal((await code()).restart, true);
  } finally {
    // 1ms 앞으로 되돌린다: st.mtime(Date)으로 되돌리면 밀리초로 반올림돼서 원래보다 최대 0.5ms 늦어질 수 있고,
    // config.js가 서버 쪽에서 가장 최근에 고친 파일이면(회차마다 main에 합친 직후) '바뀌었다'가 남아 가끔 실패했다
    fs.utimesSync(f, st.atime, new Date(st.mtimeMs - 1));
  }
  assert.equal((await code()).restart, false, why());
});

test('hooks 상태: 설정에 없으면 꺼져 있다며 넣는 명령을 알려 준다', async () => {
  const h = JSON.parse((await get('/api/hooks')).body);
  assert.equal(h.state, 'off');
  assert.equal(h.cmd, `node ${JSON.stringify(path.join(ROOT, 'server.js'))} --install-hooks`, '화면에서는 어느 폴더에서 쳐도 되게 전체 경로로');
  // 도구가 가는 방 설정 상태도 같이 (도움말 창용): 설정 파일이 없으면 없다고
  assert.deepEqual(h.rooms, { file: path.join(CFG, 'claude-office.json'), exists: false, count: 0, problem: '' });
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

test('시각 없는 장부 줄만 붙은 옛 세션은 방금 움직인 걸로 보지 않는다 (빌딩·자동 모드·세션 목록)', async () => {
  // 데스크톱 앱은 며칠 지난 세션에도 artifact-autoreact-ledger 줄을 덧붙여서 파일이 바뀐 시각만 새로워진다
  const LEDGER = 'dddddddd-4444-0000-0000-000000000004';
  const file = path.join(PROJ, LEDGER + '.jsonl');
  const twoDays = new Date(Date.now() - 2 * 86400000).toISOString();
  try {
    fs.writeFileSync(file, JSON.stringify({ type: 'user', uuid: 'old-1', timestamp: twoDays, cwd: '/tmp/shop', message: { role: 'user', content: '옛날 일' } }) + '\n');
    fs.appendFileSync(file, JSON.stringify({ type: 'artifact-autoreact-ledger', v: 1, sessionId: LEDGER, artifacts: [] }) + '\n'); // mtime은 지금
    const all = stream('all');
    const hello = await until(() => all.log.find(x => x.ev === 'hello'));
    all.close();
    assert.ok(!hello.sessions.some(x => x.sid === LEDGER), '빌딩에 들어오지 않는다');
    const auto = stream('auto');
    const first = await until(() => auto.log.find(x => x.ev === 'hello'));
    auto.close();
    assert.deepEqual(first.sessions.map(x => x.sid), [SHOP], '자동 모드는 파일만 새로워진 옛 세션으로 가지 않는다');
    const listed = JSON.parse((await get('/api/sessions')).body).sessions.find(x => x.id === LEDGER);
    assert.ok(listed && listed.active < Date.now() - 86400000, `목록의 '… 전'은 마지막 기록 시각으로 (${listed && listed.active})`);
    // 목록 차례도 마지막 기록 시각으로: 한 시간 전에 멈춘 세션보다 아래
    const ids = JSON.parse((await get('/api/sessions')).body).sessions.map(x => x.id);
    assert.ok(ids.indexOf(LEDGER) > ids.indexOf(OLD), ids.join(' '));
  } finally {
    fs.rmSync(file, { force: true });
  }
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
  assert.ok(intro.startTs > 0 && typeof intro.toolsBefore === 'number'); // 정보 카드의 '도구 n번 · n분째'용
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
  assert.equal(j.hours.length, 24); // 시간대별 도구 사용
  assert.equal(j.hours.reduce((a, b) => a + b, 0), j.totals.tools);
  assert.ok(j.hours[fixtureHour] >= 2, `${fixtureHour}시: ${j.hours}`); // 방금 쓴 도구는 그 시간대에
  const md = await get('/api/journal?format=md');
  assert.match(md.headers['content-type'], /text\/markdown/);
  assert.match(md.body, /### shop/);
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

test('업무 일지: 한 주 모아 보기 (?week=0은 월요일부터 오늘까지)', async () => {
  const w = JSON.parse((await get('/api/journal?week=0')).body);
  assert.match(w.title, /주간 업무 일지$/);
  assert.equal(w.days.length, (new Date().getDay() + 6) % 7 + 1);
  assert.match(w.md, /^## .+ 주간 업무 일지\n/, '📋 복사용 마크다운도 같이 온다');
  assert.match(JSON.parse((await get('/api/journal?day=0')).body).md, /^## \d+월 \d+일 업무 일지\n/);
  assert.equal(w.today, true);
  const shop = w.projects.find(p => p.project === 'shop');
  assert.ok(shop && shop.days >= 1 && shop.sessions[0].file, '오늘 일한 프로젝트와 다시 볼 세션 파일이 들어 있다');
  assert.ok(w.totals.tools >= shop.tools);
  const md = await get('/api/journal?week=-1&format=md');
  assert.match(md.body, /^## .+~.+ 주간 업무 일지\n/);
  // 프로젝트를 고르면 그 프로젝트만 (제목에도 붙는다)
  const shopOnly = JSON.parse((await get('/api/journal?week=0&project=SHOP')).body);
  assert.deepEqual(shopOnly.projects.map(p => p.project), ['shop']);
  assert.match(shopOnly.title, / · SHOP$/);
  const none = await get('/api/journal?day=0&format=md&project=' + encodeURIComponent('없는-프로젝트'));
  assert.match(none.body, /'없는-프로젝트'가 든 프로젝트에서 오늘은 아직 일한 기록이 없어요/);
  // 화면의 '이 프로젝트만'(exact=1)은 이름이 꼭 같은 프로젝트만: 'sho'는 shop에 들어 있지만 shop이 아니다
  // (전에는 'blog'를 누르면 'blog-admin'까지 섞였다. 터미널의 --project는 지금처럼 '이름이 든')
  assert.deepEqual(JSON.parse((await get('/api/journal?week=0&project=sho')).body).projects.map(p => p.project), ['shop']);
  assert.deepEqual(JSON.parse((await get('/api/journal?week=0&project=sho&exact=1')).body).projects, []);
  assert.deepEqual(JSON.parse((await get('/api/journal?day=0&project=Shop&exact=1')).body).projects.map(p => p.project), ['shop']);
  assert.match((await get('/api/journal?day=0&format=md&exact=1&project=sho')).body, /'sho' 프로젝트에서 오늘은 아직 일한 기록이 없어요/);
  // 폴더(cwd)도 주면 그 폴더의 프로젝트만 (이름이 같은 다른 폴더의 프로젝트는 빼고)
  assert.deepEqual(JSON.parse((await get('/api/journal?week=0&exact=1&project=shop&cwd=' + encodeURIComponent('/tmp/shop'))).body).projects.map(p => p.project), ['shop']);
  assert.deepEqual(JSON.parse((await get('/api/journal?week=0&exact=1&project=shop&cwd=' + encodeURIComponent('/elsewhere/shop'))).body).projects, []);
  // 한 달: 주마다 묶은 막대와 날 수
  const m = JSON.parse((await get('/api/journal?month=0')).body);
  assert.match(m.title, /^\d{4}년 \d{1,2}월 업무 일지 \(/);
  assert.equal(m.days, new Date().getDate());
  assert.equal(m.weeks.reduce((n, x) => n + x.tools, 0), m.totals.tools);
  assert.match((await get('/api/journal?month=-1&format=md')).body, /^## \d{4}년 \d{1,2}월 업무 일지/);
  // 없는 날·앞날·모르는 값은 엉뚱한 날 일지 대신 400과 무엇이 틀렸는지
  for (const q of ['day=2026-13-45', 'day=abc', 'day=1', 'week=1', 'week=xyz', 'month=-99999']) {
    const r = await get('/api/journal?' + q);
    assert.equal(r.status, 400, q);
    assert.match(JSON.parse(r.body).error, /모르겠어요/, q);
  }
  const badMd = await get('/api/journal?day=abc&format=md');
  assert.equal(badMd.status, 400);
  assert.match(badMd.headers['content-type'], /^text\/plain/);
  // 파일을 한 번만 읽어 날마다 나눠 세도 하루씩 따로 본 것과 같다
  for (const [i, d] of w.days.entries()) {
    const one = JSON.parse((await get('/api/journal?day=' + (i - w.days.length + 1))).body);
    assert.equal(d.since, one.since);
    assert.deepEqual([d.workedMs, d.tools], [one.totals.workedMs || 0, one.totals.tools || 0]);
  }
});

test('업무 일지를 터미널에도 출력한다 (--journal)', () => {
  const out = server('--journal');
  assert.match(out, /업무 일지/);
  assert.match(out, /\bshop\b/);
  assert.match(out, /일한 시간/);
  assert.match(out, /시간대  [·▁▂▃▄▅▆▇█]{24}/);
  assert.match(server('--journal', '--md'), /^## \d+월 \d+일 업무 일지/m); // 슬랙·노션에 붙여 넣을 마크다운
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

test('권한 창을 띄운 채 Claude Code가 꺼지면(SessionEnd 없이) 기다림을 지운다', { skip: process.platform === 'win32' }, async () => {
  const s = stream('all');
  await until(() => s.log.find(x => x.ev === 'hello'));
  toolUse(shop, 'k9', 'Bash', { command: 'npm publish', description: '배포' });
  await sleep(400);
  // 곧 끝나는 프로세스를 'Claude Code'로 삼는다 (hook의 부모 pid 자리에 넣는다)
  const fake = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1200)'], { stdio: 'ignore' });
  const rt = JSON.parse(fs.readFileSync(ENV.CLAUDE_OFFICE_RUNTIME, 'utf8'));
  const body = JSON.stringify({ session_id: SHOP, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm publish', description: '배포' }, ppid: fake.pid });
  await new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: '/hook', headers: { 'X-Office-Token': rt.token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => { res.resume(); res.on('end', resolve); });
    req.end(body);
  });
  const w = await until(() => s.lastWait(SHOP));
  assert.equal(w.id, 'k9');
  await sleep(600);
  assert.ok(s.lastWait(SHOP), '아직 살아 있으면 계속 기다린다');
  assert.equal(await until(() => s.lastWait(SHOP) === null, 5000), true, '꺼지면 지운다');
  toolResult(shop, 'k9', false);
  s.close();
});

test('보고 있는 화면이 없어도, 권한을 기다리던 Claude Code가 꺼지면 세션 목록의 🔐를 지운다', { skip: process.platform === 'win32' }, async () => {
  const GONE = 'eeeeeeee-5555-0000-0000-000000000005';
  const file = path.join(PROJ, GONE + '.jsonl');
  userMsg(file, '옛날 일');
  const old = new Date(Date.now() - 3 * 3600 * 1000);
  fs.utimesSync(file, old, old); // 빌딩에도 안 들어오는 오래된 세션 (따라 읽는 화면이 없다)
  const fake = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], { stdio: 'ignore' });
  const rt = JSON.parse(fs.readFileSync(ENV.CLAUDE_OFFICE_RUNTIME, 'utf8'));
  const body = JSON.stringify({ session_id: GONE, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: '허락해 주세요', ppid: fake.pid });
  await new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: '/hook', headers: { 'X-Office-Token': rt.token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => { res.resume(); res.on('end', resolve); });
    req.end(body);
  });
  const waiting = async () => JSON.parse((await get('/api/sessions')).body).sessions.find(x => x.id === GONE).waiting;
  assert.equal(await waiting(), true);
  await new Promise(r => fake.on('exit', r));
  assert.equal(await waiting(), false);
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

test('대화 압축: PreCompact hook을 받으면 압축 중이라고 알리고, 압축이 기록되면 푼다', async () => {
  const s = stream('all');
  await until(() => s.log.find(x => x.ev === 'hello'));
  hook({ session_id: SHOP, transcript_path: shop, hook_event_name: 'PreCompact', trigger: 'manual', custom_instructions: '' });
  const c = await until(() => s.lastCompact(SHOP));
  assert.equal(c.trigger, 'manual');
  // 압축하는 동안 보낸 내 메시지·백그라운드 작업 알림으로는 끝내지 않는다
  put(shop, { type: 'attachment', attachment: { type: 'queued_command', prompt: '압축하는 동안 보낸 말', origin: { kind: 'human' } } });
  put(shop, { type: 'attachment', attachment: { type: 'queued_command', prompt: '<task-notification><status>completed</status><summary>빌드 끝</summary></task-notification>' } });
  await sleep(600);
  assert.ok(s.lastCompact(SHOP));
  put(shop, { type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'manual', preTokens: 150000, postTokens: 30000, durationMs: 900 } });
  assert.equal(await until(() => s.lastCompact(SHOP) === null), true);
  // 쉬는 동안 미리 써 둔 요약으로 바꾸면 압축이 hook보다 먼저 기록된다: 그때는 압축 중으로 남지 않는다
  put(shop, { type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 150000, postTokens: 30000, durationMs: 20, precomputed: true } });
  await sleep(400);
  const before = s.updates(SHOP).length;
  hook({ session_id: SHOP, transcript_path: shop, hook_event_name: 'PreCompact', trigger: 'auto' });
  await sleep(600);
  assert.ok(!s.updates(SHOP).slice(before).some(u => u.compacting));
  s.close();
  // hook을 받아 봤으니 설정에서 못 찾아도 켜져 있는 거다
  assert.equal(JSON.parse((await get('/api/hooks')).body).state, 'on');
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

test('Claude Code를 닫으면(SessionEnd) 30분을 기다리지 않고 바로 퇴근하고, 이어 하면 다시 출근한다', async () => {
  const BYE = 'ffffffff-6666-0000-0000-000000000006';
  const file = path.join(PROJ2, BYE + '.jsonl');
  userMsg(file, '오늘 글 다듬어 줘');
  const s = stream('all');
  await until(() => s.log.find(x => x.ev === 'hello'));
  await until(() => s.log.find(x => (x.ev === 'join' && x.sid === BYE) || (x.ev === 'hello' && x.sessions.some(y => y.sid === BYE))), 4000);
  hook({ session_id: BYE, transcript_path: file, hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
  const leave = await until(() => s.log.find(x => x.ev === 'leave' && x.sid === BYE), 4000);
  assert.equal(leave.why, 'ended');
  assert.ok(s.updates(BYE).some(u => u.ended > 0), '닫았다고 화면에도 알린다 (이 세션만 보거나 마지막 한 명이면 남아 있으니까)');
  await sleep(2500);
  userMsg(file, '이어서 하자'); // claude --resume으로 이어 하면 기록이 다시 는다
  const back = await until(() => s.log.find(x => x.ev === 'join' && x.sid === BYE && s.log.indexOf(x) > s.log.indexOf(leave)), 5000);
  assert.ok(back, '다시 출근한다');
  assert.equal(back.ended, 0);
  s.close();
});

test('이 세션만 볼 때 Claude Code를 닫으면 나가지는 않고 닫았다고 알려 준다', async () => {
  const PIN = 'ffffffff-7777-0000-0000-000000000007';
  const file = path.join(PROJ2, PIN + '.jsonl');
  userMsg(file, '배포 스크립트 봐 줘');
  toolUse(file, 'q1', 'AskUserQuestion', { questions: [{ question: '어디에 배포할까요?', options: [] }] });
  const s = stream(file);
  const hello = await until(() => s.log.find(x => x.ev === 'hello'));
  assert.equal(hello.sessions[0].ended, 0);
  hook({ session_id: PIN, transcript_path: file, hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
  const u = await until(() => s.updates(PIN).find(x => x.ended > 0), 4000);
  assert.ok(u, '닫은 시각이 온다');
  const listed = JSON.parse((await get('/api/sessions')).body).sessions.find(x => x.id === PIN);
  assert.equal(listed.ended, u.ended, '세션 목록에도 닫았다고 나온다 (🚪)');
  await sleep(300);
  assert.ok(!s.log.some(x => x.ev === 'leave'), '이 세션만 보는 중이면 나가지 않는다');
  s.close();
});

test('--help는 hooks를 넣을 실제 설정 파일 경로를 알려 준다 (CLAUDE_CONFIG_DIR로 폴더를 바꿔 써도)', () => {
  assert.ok(server('--help').includes(path.join(CFG, 'settings.json')), '--install-hooks 줄에 그 경로');
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'server.js'), '--print-hooks'], { env: ENV, encoding: 'utf8' });
  assert.ok(r.stderr.includes(path.join(CFG, 'settings.json')), '--print-hooks 안내도');
  assert.ok(JSON.parse(r.stdout).hooks, '출력(stdout)은 JSON만이라 파일로 받아도 된다');
});

test("세션 목록에 다시 켜는 명령을 실어 준다 ('npx claude-office'는 다른 사람 패키지라 쓰지 않는다)", async () => {
  const d = JSON.parse((await get('/api/sessions')).body);
  assert.match(d.start, /server\.js|\/office:open|main\.tar\.gz/);
  assert.doesNotMatch(d.start, /npx claude-office\b/);
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
    const port = PORT + 7;
    const env = { ...ENV, CLAUDE_CONFIG_DIR: cfg, CLAUDE_OFFICE_RUNTIME: path.join(TMP, 'rt-leave.json'), CLAUDE_OFFICE_ACTIVE_MINUTES: '0.05' }; // 3초
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--port', String(port)], { env, stdio: 'ignore' });
    const log = [];
    let req;
    try {
      assert.ok(await until(() => fs.existsSync(env.CLAUDE_OFFICE_RUNTIME), 10000));
      // 기록은 서버가 뜬 뒤에 쓴다: 빌딩에 머무는 시간이 3초라, 컴퓨터가 바빠 서버가 늦게 뜨면 미리 써 둔 기록은
      // 첫 화면 전에 이미 '오래 조용한' 세션이 돼서 hello가 하나만 오는 일이 있었다
      userMsg(fa, '첫 번째');
      await sleep(50);
      userMsg(fb, '두 번째');
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
    const port = PORT + 8;
    const env = { ...ENV, CLAUDE_CONFIG_DIR: cfg, CLAUDE_OFFICE_RUNTIME: path.join(TMP, 'rt-limit.json'), CLAUDE_OFFICE_ACTIVE_MINUTES: '0.05' }; // 3초
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--port', String(port)], { env, stdio: 'ignore' });
    const log = [];
    let req;
    try {
      assert.ok(await until(() => fs.existsSync(env.CLAUDE_OFFICE_RUNTIME), 10000));
      // 기록은 서버가 뜬 뒤에 (위 퇴근 테스트와 같은 까닭)
      userMsg(fl, '계속해 줘');
      put(fl, { type: 'assistant', cwd: '/tmp/limit', message: { model: '<synthetic>', content: [{ type: 'text', text: `You've hit your session limit · resets ${clock} (Asia/Seoul)` }] } });
      await sleep(50);
      userMsg(fq, '그냥 조용한 세션');
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
    const out = await new Promise(resolve => execFile(process.execPath, [path.join(ROOT, 'server.js'), '--background', '--port', String(busy.address().port)], { env, timeout: LIMIT }, (e, stdout) => resolve(String(stdout))));
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
    // execFileSync로 기다리면 이 테스트(= 그 포트의 '다른 프로그램')가 멈춰서, 사무실이 '거기 사무실이 떠 있나?' 물어도
    // 대답을 못 하고 시간이 다 될 때까지 기다린다 (컴퓨터가 바쁘면 몇 분씩 늘어진 적이 있다). 비동기로 돌려 바로 대답하게
    const started = Date.now();
    const out = await new Promise(resolve => execFile(process.execPath, [path.join(ROOT, 'server.js'), '--port', String(D)],
      { env: { ...env, CLAUDE_OFFICE_RUNTIME: path.join(TMP, 'rt-x.json') }, timeout: 20000 }, (e, stdout) => resolve(String(stdout))));
    assert.match(out, /다른 프로그램이 쓰고 있어요/);
    assert.ok(Date.now() - started < 10000, '포트가 막혔다는 안내는 곧바로 나온다');
  } finally {
    child.kill();
    busy.close();
  }
});

test('localhost가 [::1]로 가도 사무실이 받고, 다른 프로그램이 [::1]의 그 포트를 쓰면 127.0.0.1 주소를 알려 준다', async t => {
  // 맥은 AirPlay 수신 모드가 모든 주소의 5000번을 잡고 있어서, 127.0.0.1에만 열면 localhost:5000이 403이 났다
  // [::1]에서 빈 포트를 받되, 같은 번호가 127.0.0.1에서도 비어 있어야 한다 (다른 프로그램이 127.0.0.1의 그 번호를 쓰고 있으면
  // 사무실이 '다른 프로그램이 쓰고 있어요'로 끝나서 이 테스트가 가끔 실패했다): 아니면 다른 번호로 다시
  let other = null;
  for (let i = 0; i < 20 && !other; i++) {
    const o = http.createServer((q, r) => r.end('다른 프로그램'));
    const v6 = await new Promise(resolve => o.once('error', () => resolve(false)).listen(0, '::1', () => resolve(true)));
    if (!v6) return t.skip('이 컴퓨터는 IPv6가 없어요');
    const probe = http.createServer();
    const free = await new Promise(resolve => probe.once('error', () => resolve(false)).listen(o.address().port, '127.0.0.1', () => probe.close(() => resolve(true))));
    if (free) other = o;
    else o.close();
  }
  if (!other) return t.skip('127.0.0.1과 [::1]에서 같이 빈 포트를 찾지 못했어요');
  const health = host => new Promise(resolve => http.get({ host, port: PORT, path: '/api/health' }, res => {
    let d = '';
    res.on('data', c => { d += c; });
    res.on('end', () => resolve(d));
  }).on('error', () => resolve('')));
  const P = other.address().port;
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--port', String(P)], { env: { ...ENV, CLAUDE_OFFICE_RUNTIME: path.join(TMP, 'rt-v6.json') } });
  let out = '';
  child.stdout.on('data', c => { out += c; });
  try {
    assert.match(await health('::1'), /claude-office/);
    assert.ok(await until(() => /열렸어요/.test(out), 4000), out);
    assert.match(out, new RegExp(`http://127\\.0\\.0\\.1:${P}`));
  } finally {
    child.kill();
    other.close();
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

test('빌딩이 꽉 차면(12명) 가장 오래 조용한 직원이 자리를 내주고, 꽉 차서라고 알린다', async () => {
  const dir = path.join(CFG, 'projects', '-tmp-crowd');
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  const s = stream('all');
  try {
    const hello = await until(() => s.log.find(x => x.ev === 'hello'));
    // 12명이 될 때까지 채우고 한 명 더 (처음 채운 사람이 가장 오래 조용하다)
    for (let i = 0; i < 13 - hello.sessions.length; i++) {
      const f = path.join(dir, `eeee${String(i).padStart(4, '0')}-0000-0000-0000-000000000000.jsonl`);
      userMsg(f, `일 ${i}`);
      files.push(f);
      await sleep(20);
    }
    const leave = await until(() => s.log.find(x => x.ev === 'leave'), 8000);
    assert.ok(leave, '아무도 나가지 않았어요');
    assert.deepEqual([leave.why, leave.max], ['full', 12]);
  } finally {
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

test('뒤에서 켤 때 같은 폴더의 사무실이 켠 뒤로 바뀐 코드를 모르면(git pull, 버전은 그대로) 끄고 다시 켠다', async () => {
  const runtime = require('../lib/runtime');
  const token = 'same-version-token';
  const version = require('../package.json').version;
  let health = {}, stopped = false;
  const fake = http.createServer((req, res) => {
    res.setHeader('Connection', 'close');
    if (req.url === '/api/health') return res.end(JSON.stringify({ app: 'claude-office', version, pid: process.pid, ...health }));
    if (req.method === 'POST' && req.url === '/api/shutdown' && req.headers['x-office-token'] === token) {
      stopped = true;
      res.end('bye');
      return fake.close();
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const port = fake.address().port;
  fs.writeFileSync(ENV.CLAUDE_OFFICE_RUNTIME, JSON.stringify({ pid: process.pid, port, token, version }), { mode: 0o600 });
  const run = (...a) => new Promise((resolve, reject) => execFile(process.execPath, [path.join(ROOT, 'server.js'), ...a], { env: ENV, timeout: LIMIT }, (e, out) => (e ? reject(e) : resolve(out))));
  try {
    health = { root: ROOT, stamp: Date.now() + 3600000 }; // 코드를 읽은 뒤로 바뀐 게 없으면 그대로
    assert.match(await run('--background'), /이미 켜져/);
    health = { root: '/some/other/claude-office', stamp: 1 }; // 다른 폴더의 사무실이면 견주지 않는다
    assert.match(await run('--background'), /이미 켜져/);
    assert.equal(stopped, false);
    health = { root: ROOT, stamp: 1 }; // 이 폴더의 코드가 그 뒤로 바뀌었다
    const out = await run('--background');
    assert.match(out, /켠 뒤로 바뀐 코드를 아직 몰라서\(git pull 등\) 끄고 다시 켤게요/);
    assert.match(out, new RegExp(`뒤에서 켰어요 → http://localhost:${port}`));
    assert.ok(stopped);
    const now = await runtime.health(port);
    assert.equal(now.root, ROOT);
    assert.ok(now.stamp > 1);
  } finally {
    if (fake.listening) fake.close();
    await run('--stop').catch(() => {});
  }
});

test('그냥 켰는데 같은 폴더의 사무실이 바뀌기 전 코드로 켜져 있으면 그렇다고 알려 준다 (끄지는 않는다)', async () => {
  let health = { root: ROOT, stamp: 1 };
  const fake = http.createServer((req, res) => {
    res.setHeader('Connection', 'close');
    if (req.url === '/api/health') return res.end(JSON.stringify({ app: 'claude-office', version: require('../package.json').version, pid: process.pid, ...health }));
    res.writeHead(404);
    res.end();
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const port = String(fake.address().port);
  // 가짜 사무실이 이 테스트 안에서 답해야 하니 기다리지 않고 실행한다
  const run = (...a) => new Promise((resolve, reject) => execFile(process.execPath, [path.join(ROOT, 'server.js'), ...a], { env: ENV, timeout: LIMIT }, (e, out) => (e ? reject(e) : resolve(out))));
  try {
    assert.match(await run('--port', port), /이미 켜져 있어요[\s\S]*바뀌기 전 코드예요[\s\S]*--background\S*로 켜면 알아서 바꿔 켜요/);
    health = { root: ROOT, stamp: Date.now() + 3600000 };
    assert.doesNotMatch(await run('--port', port), /바뀌기 전 코드/);
  } finally {
    fake.close();
  }
});

test('뒤에서 켤 때 예전 버전 사무실이 켜져 있으면 끄고 같은 포트로 새로 켠다 (새 버전이면 그대로 둔다)', async () => {
  const runtime = require('../lib/runtime');
  const token = 'old-office-token';
  let version = '0.0.1', stopped = false;
  // 예전 사무실 흉내: 상태 알려 주기와 끄기만 한다
  const fake = http.createServer((req, res) => {
    res.setHeader('Connection', 'close');
    if (req.url === '/api/health') return res.end(JSON.stringify({ app: 'claude-office', version, pid: process.pid }));
    if (req.method === 'POST' && req.url === '/api/shutdown' && req.headers['x-office-token'] === token) {
      stopped = true;
      res.end('bye');
      return fake.close();
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const port = fake.address().port;
  const writeRt = () => fs.writeFileSync(ENV.CLAUDE_OFFICE_RUNTIME, JSON.stringify({ pid: process.pid, port, token, version }), { mode: 0o600 });
  // 이 테스트 안에서 예전 사무실이 답해야 하니 기다리지 않고 실행한다
  const run = (...a) => new Promise((resolve, reject) => execFile(process.execPath, [path.join(ROOT, 'server.js'), ...a], { env: ENV, timeout: LIMIT }, (e, out) => (e ? reject(e) : resolve(out))));
  try {
    version = '99.0.0'; // 더 새 버전이 켜져 있으면 건드리지 않는다
    writeRt();
    assert.match(await run('--background'), /이미 켜져/);
    assert.equal(stopped, false);
    version = '0.0.1';
    const out = await run('--background');
    assert.match(out, /예전 버전\(0\.0\.1\)이라 끄고 새 버전/);
    assert.match(out, new RegExp(`뒤에서 켰어요 → http://localhost:${port}`));
    assert.ok(stopped);
    assert.equal((await runtime.health(port)).version, require('../package.json').version);
  } finally {
    if (fake.listening) fake.close();
    await run('--stop').catch(() => {});
  }
});
