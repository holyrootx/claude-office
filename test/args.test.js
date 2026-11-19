// 명령줄 옵션 점검(lib/config.js argProblem): 오타는 조용히 넘기지 않고 무엇이 틀렸는지 알려 준다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { argProblem, argWords } = require('../lib/config');

test('아는 옵션과 그 값은 통과한다', () => {
  for (const a of [[], ['--port', '4800', '--no-open'], ['--active', '60'], ['--background'], ['--stop'], ['--print-hooks'], ['--install-hooks'], ['--uninstall-hooks'], ['-v'], ['--help']]) {
    assert.equal(argProblem(a), null, a.join(' '));
  }
  // --journal 뒤의 날은 -2처럼 -로 시작해도 값이고, 날 없이 바로 --md가 와도 된다
  assert.equal(argProblem(['--journal', '-2', '--md']), null);
  assert.equal(argProblem(['--journal', '--md']), null);
  assert.equal(argProblem(['--journal', '어제']), null);
});

test('모르는 옵션·= 붙여 쓰기·숫자가 아닌 값은 무엇이 틀렸는지 알려 준다', () => {
  assert.equal(argProblem(['--prot', '5000']), '모르는 옵션이에요: --prot');
  assert.equal(argProblem(['--port=5000']), '--port 5000처럼 띄어 써 주세요');
  assert.match(argProblem(['--port']), /--port 뒤에 포트 번호를/);
  assert.match(argProblem(['--port', 'abc']), /--port 뒤에 포트 번호를/);
  assert.match(argProblem(['--port', '70000']), /--port 뒤에 포트 번호를/);
  assert.match(argProblem(['--active', '--no-open']), /--active 뒤에 분을/);
});

test('옵션 없이 홀로 적은 말은 조용히 넘기지 않는다 (전에는 4800이 기본 포트로, journal이 사무실 켜기로 넘어갔다)', () => {
  assert.equal(argProblem(['4800']), '모르는 말이에요: 4800 (포트라면 --port 4800처럼 적어 주세요)');
  assert.equal(argProblem(['journal', '어제']), '모르는 말이에요: journal (--journal처럼 앞에 --를 붙여 주세요)');
  assert.equal(argProblem(['Stop']), '모르는 말이에요: Stop (--stop처럼 앞에 --를 붙여 주세요)');
  assert.equal(argProblem(['--port', '4800', 'extra']), '모르는 말이에요: extra (업무 일지의 날이라면 --journal extra처럼 적어 주세요)');
  // 여러 말로 된 날·빈칸이 든 프로젝트 이름은 다음 옵션 앞까지 한 덩어리라 괜찮다
  for (const a of [['--journal', '지난', '주', '금요일'], ['--journal', '3일', '전', '--project', 'my', 'app', '--md'], ['--journal', '--project', 'my', 'app']]) {
    assert.equal(argProblem(a), null, a.join(' '));
  }
});

test('옵션 값은 다음 옵션 앞까지 모은다: --project my app → my app (전에는 my만 보고 app은 버렸다)', () => {
  assert.equal(argWords('--project', ['--journal', '어제', '--project', 'my', 'app', '--md']), 'my app');
  assert.equal(argWords('--journal', ['--journal', '지난', '주', '금요일', '--md']), '지난 주 금요일');
  assert.equal(argWords('--journal', ['--journal', '--md']), '');
  assert.equal(argWords('--project', ['--journal']), undefined);
});

test('쓸 수 있는 옵션은 다 --help에 나온다 (새 옵션을 넣고 도움말을 빠뜨리지 않게)', () => {
  const { execFileSync } = require('child_process');
  const path = require('path');
  const help = execFileSync(process.execPath, [path.join(__dirname, '..', 'server.js'), '--help']).toString();
  const { OPTIONS } = require('../lib/config');
  for (const opt of Object.keys(OPTIONS)) assert.ok(help.includes(opt), `${opt}가 도움말에 없어요`);
});

test('--project는 뒤에 이름이 있어야 한다', () => {
  const { argProblem } = require('../lib/config');
  assert.equal(argProblem(['--journal', '지난', '주', '--project', 'blog']), null);
  assert.match(argProblem(['--journal', '--project']), /--project 뒤에 프로젝트 이름을/);
  assert.match(argProblem(['--project', '--md']), /--project 뒤에 프로젝트 이름을/);
});

test('--md·--project만 쓰면 사무실을 켜지 않고 --journal과 같이 쓰라고 알려 준다', () => {
  const { argProblem } = require('../lib/config');
  assert.equal(argProblem(['--md']), '--md는 --journal과 같이 써요 (예: --journal 지난 주 --md)');
  assert.equal(argProblem(['--project', 'blog']), '--project는 --journal과 같이 써요 (예: --journal 지난 주 --project blog)');
  assert.equal(argProblem(['--no-open', '--project', 'blog', '--md']), '--md는 --journal과 같이 써요 (예: --journal 지난 주 --md)');
  assert.equal(argProblem(['--journal', '--md', '--project', 'blog']), null);
});

test('환경 변수 PORT·CLAUDE_OFFICE_ACTIVE_MINUTES가 잘못됐으면 무엇이 틀렸는지 알려 준다 (명령줄에 적었으면 그쪽을 쓴다)', () => {
  const { envProblem } = require('../lib/config');
  assert.equal(envProblem({}, []), null);
  assert.equal(envProblem({ PORT: '4800', CLAUDE_OFFICE_ACTIVE_MINUTES: '60' }, []), null);
  for (const p of ['99999', '-1', '1.5', 'abc']) assert.match(envProblem({ PORT: p }, []), new RegExp(`PORT=${p.replace('.', '\\.')}는 포트 번호로 쓸 수 없어요`), p);
  assert.equal(envProblem({ PORT: '99999' }, ['--port', '4800']), null);
  for (const m of ['-5', '0', 'abc']) assert.match(envProblem({ CLAUDE_OFFICE_ACTIVE_MINUTES: m }, []), /CLAUDE_OFFICE_ACTIVE_MINUTES=.*0보다 큰 분으로/, m);
  assert.equal(envProblem({ CLAUDE_OFFICE_ACTIVE_MINUTES: '-5' }, ['--active', '60']), null);
});

test('PORT=99999로 켜면 Node 오류 글 대신 우리말로 알려 주고 켜지 않는다 (일지는 PORT와 상관없이 된다)', () => {
  const { spawnSync } = require('child_process');
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-env-'));
  try {
    const env = { ...process.env, PORT: '99999', NO_OPEN: '1', CLAUDE_CONFIG_DIR: tmp, CLAUDE_OFFICE_RUNTIME: path.join(tmp, 'rt.json') };
    const run = (...a) => spawnSync(process.execPath, [path.join(__dirname, '..', 'server.js'), ...a], { env, encoding: 'utf8', timeout: 20000 });
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stdout, /환경 변수 PORT=99999는 포트 번호로 쓸 수 없어요/);
    assert.doesNotMatch(r.stderr, /RangeError|ERR_SOCKET_BAD_PORT/);
    assert.equal(run('--journal').status, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('포트: CLAUDE_OFFICE_PORT가 PORT보다 먼저고, 다른 앱용일 수 있는 PORT를 따라 켜면 그렇다고 알려 준다', async () => {
  const { spawn } = require('child_process');
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const net = require('net');
  const { envProblem } = require('../lib/config');
  assert.match(envProblem({ CLAUDE_OFFICE_PORT: '0' }, []), /CLAUDE_OFFICE_PORT=0는 포트 번호로/);
  assert.equal(envProblem({ CLAUDE_OFFICE_PORT: '4800', PORT: 'abc' }, []), null); // 사무실 것이 있으면 PORT는 안 본다
  const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-port-'));
  // 켜서 '열렸어요' 줄이 나오면 출력을 돌려주고 끈다
  const open = env => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, CLAUDE_OFFICE_PORT: '', PORT: '', ...env, NO_OPEN: '1', CLAUDE_CONFIG_DIR: tmp, CLAUDE_OFFICE_RUNTIME: path.join(tmp, 'rt.json') } });
    let out = '';
    const t = setTimeout(() => { c.kill(); reject(new Error('20초 안에 켜지지 않았어요: ' + out)); }, 20000);
    c.stdout.on('data', d => {
      out += d;
      if (/열렸어요[^\n]*\n/.test(out)) { clearTimeout(t); c.kill(); c.on('exit', () => resolve(out)); }
    });
  });
  try {
    const [a, b] = [await free(), await free()];
    const viaPort = await open({ PORT: String(a) });
    assert.match(viaPort, new RegExp(`열렸어요 → http://[^:]+:${a}`));
    assert.match(viaPort, new RegExp(`환경 변수 PORT=${a}를 따라 이 포트로 열었어요[^\\n]*CLAUDE_OFFICE_PORT`));
    const viaOffice = await open({ PORT: String(a), CLAUDE_OFFICE_PORT: String(b) });
    assert.match(viaOffice, new RegExp(`열렸어요 → http://[^:]+:${b}`));
    assert.doesNotMatch(viaOffice, /환경 변수 PORT=/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
