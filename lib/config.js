// 실행 옵션과 설정값. 명령줄(--port, --active, --no-open)과 환경 변수를 한곳에서 읽는다.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const argValue = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
// 옵션 뒤에 띄어 쓴 말을 다음 옵션(--…) 앞까지 모은다: --project my app → 'my app' (폴더 이름에 빈칸이 있어도)
const argWords = (name, list = args) => {
  const i = list.indexOf(name);
  if (i < 0) return undefined;
  const rest = list.slice(i + 1);
  const end = rest.findIndex(a => a.startsWith('--'));
  return (end < 0 ? rest : rest.slice(0, end)).join(' ');
};

// 아는 옵션. number는 뒤에 숫자를 받고, maybe(--journal)는 날을 붙여도 되고 안 붙여도 된다.
const OPTIONS = {
  '--port': 'number', '--active': 'number', '--journal': 'maybe', '--project': 'text',
  '--no-open': 0, '--background': 0, '--stop': 0, '--print-hooks': 0, '--install-hooks': 0, '--uninstall-hooks': 0, '--md': 0, '--help': 0, '-h': 0, '--version': 0, '-v': 0,
};

const validPort = v => Number.isInteger(v) && v > 0 && v < 65536;
const DASHES = /^[-\u2010-\u2015\u2212]+/; // - ‐ ‑ ‒ – — ― −

// 두 말이 몇 글자 다른지 (바꾸기·넣기·빼기·옆 글자와 자리 바꾸기를 한 번으로 센다: prot → port는 1)
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// 잘못 쓴 옵션과 가장 가까운 옵션 (--prot → --port, --PORT → --port, --jornal → --journal, --uninstall → --uninstall-hooks).
// 가깝다고 할 만한 게 하나뿐일 때만 알려 준다: 짧은 이름(4글자까지)은 한 글자, 긴 이름은 두 글자까지 다르거나, 앞부분이 하나에만 맞을 때
function nearOption(a) {
  const want = String(a).replace(DASHES, '').toLowerCase();
  if (!want) return null;
  const names = Object.keys(OPTIONS).filter(o => o.startsWith('--')).map(o => o.slice(2));
  const limit = want.length <= 4 ? 1 : 2;
  const scored = names.map(n => [n, editDistance(want, n)]).filter(([, d]) => d <= limit);
  const best = Math.min(...scored.map(([, d]) => d));
  const close = scored.filter(([, d]) => d === best);
  if (close.length === 1) return '--' + close[0][0];
  if (close.length > 1) return null;
  const starts = names.filter(n => n.startsWith(want));
  return starts.length === 1 ? '--' + starts[0] : null;
}

// 잘못 쓴 옵션을 찾아 무엇이 틀렸는지 돌려준다 (없으면 null).
// 오타(--prot 5000)를 모른 척 넘기면 엉뚱한 포트로 조용히 켜져서 왜 안 열리는지 알기 어렵다.
function argProblem(list = args) {
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const kind = OPTIONS[a];
    if (kind === undefined) {
      const eq = a.indexOf('=');
      const name = eq < 0 ? a : a.slice(0, eq);
      const value = eq < 0 ? '' : a.slice(eq + 1);
      // 아는 옵션에 =를 붙여 쓴 것 (--journal=어제, --no-open=1): 전에는 --port만 알아보고 나머지는 '모르는 옵션'이라고 해서
      // 옵션 이름을 잘못 쓴 줄 알았다
      if (eq > 0 && OPTIONS[name] !== undefined) {
        if (OPTIONS[name] === 0) return `${name} 뒤에는 값을 붙이지 않아요 (${name}만 적어 주세요)`;
        return value ? `${name} ${value}처럼 띄어 써 주세요` : `${name} 뒤에 =를 붙이지 말고 띄어 써 주세요`;
      }
      if (a.startsWith('--')) {
        const near = nearOption(name);
        return `모르는 옵션이에요: ${a}${near ? ` (${near} 말인가요?)` : ''}`;
      }
      // 옵션 뒤가 아닌 데 홀로 적은 말: 전에는 조용히 넘겨서 'node server.js 4800'(--port를 빠뜨림)이 기본 포트로,
      // 'node server.js journal'(--를 빠뜨림)이 일지 대신 사무실을 켜 버렸다
      if (/^\d+$/.test(a)) return `모르는 말이에요: ${a} (포트라면 --port ${a}처럼 적어 주세요)`;
      // —port처럼 대시가 다른 글자로 바뀐 것도 (메모 앱·메신저에서 복사하면 --가 — 하나로 바뀌곤 한다)
      const opt = Object.keys(OPTIONS).find(o => o.startsWith('--') && o.slice(2) === a.replace(DASHES, '').toLowerCase());
      if (opt && /^[\u2010-\u2015\u2212]/.test(a)) return `모르는 말이에요: ${a} (${opt}처럼 -를 두 개 적어 주세요: 붙여 넣으면서 --가 다른 글자로 바뀐 것 같아요)`;
      return opt ? `모르는 말이에요: ${a} (${opt}처럼 앞에 --를 붙여 주세요)` : `모르는 말이에요: ${a} (업무 일지의 날이라면 --journal ${a}처럼 적어 주세요)`;
    }
    if (kind === 'number') {
      const v = Number(list[i + 1]);
      const ok = a === '--port' ? validPort(v) : v > 0;
      if (!ok) return `${a} 뒤에 ${a === '--port' ? '포트 번호를' : '분을'} 적어 주세요 (예: ${a} ${a === '--port' ? 4800 : 60})`;
      i++;
    } else if (kind === 'text') {
      if (!list[i + 1] || list[i + 1].startsWith('--')) return `${a} 뒤에 프로젝트 이름을 적어 주세요 (예: ${a} blog)`;
      while (list[i + 1] && !list[i + 1].startsWith('--')) i++; // 빈칸이 든 이름 (my app)
    } else if (kind === 'maybe') {
      while (list[i + 1] && !list[i + 1].startsWith('--')) i++; // --journal 지난 주 금요일: 날은 여러 말일 수 있다
    }
  }
  // --md·--project는 업무 일지를 고르는 말이라 --journal 없이 쓰면 일지 대신 사무실이 켜져 버린다 (브라우저까지 열리고)
  if (!list.includes('--journal')) {
    const lone = ['--md', '--project'].find(o => list.includes(o));
    if (lone) return `${lone}는 --journal과 같이 써요 (예: --journal 지난 주 ${lone === '--md' ? '--md' : '--project blog'})`;
  }
  return null;
}

// 환경 변수 PORT·CLAUDE_OFFICE_ACTIVE_MINUTES도 명령줄 옵션과 같은 기준으로 본다 (사무실을 켤 때만 쓰는 값이라 켤 때만 부른다).
// 전에는 PORT=99999면 Node 오류 글을 그대로 쏟고 꺼졌고, CLAUDE_OFFICE_ACTIVE_MINUTES=-5면 빌딩이 말없이 늘 비어 있었다.
// 명령줄에 --port·--active를 적었으면 그쪽을 쓰니 환경 변수는 보지 않는다.
function envProblem(env = process.env, list = args) {
  const name = env.CLAUDE_OFFICE_PORT ? 'CLAUDE_OFFICE_PORT' : 'PORT';
  const port = env[name];
  if (port && !list.includes('--port') && !validPort(Number(port))) return `환경 변수 ${name}=${port}는 포트 번호로 쓸 수 없어요 (1~65535 사이의 정수, 예: ${name}=4800)`;
  const min = env.CLAUDE_OFFICE_ACTIVE_MINUTES;
  if (min && !list.includes('--active') && !(Number(min) > 0)) return `환경 변수 CLAUDE_OFFICE_ACTIVE_MINUTES=${min}는 쓸 수 없어요: 0보다 큰 분으로 적어 주세요 (예: 60)`;
  return null;
}

const VERSION = require('../package.json').version;
// --port·CLAUDE_OFFICE_PORT·PORT로 직접 정했으면 그 포트만 쓰고, 아니면 4777부터 비어 있는 포트를 찾아 쓴다
// (CLAUDE_OFFICE_DEFAULT_PORT는 테스트가 실제 4777을 건드리지 않게 시작 번호를 바꿀 때 쓴다)
// PORT는 개발 중인 다른 앱(웹 서버)용으로 셸에 늘 걸어 두는 일이 많다. 그걸 따라 켜면 사무실이 그 앱의 포트를 차지해서
// 나중에 그 앱이 안 켜진다: 사무실만 따로 정하는 CLAUDE_OFFICE_PORT를 먼저 보고, PORT를 따랐으면 켤 때 알려 준다(PORT_FROM)
const PORT_ENV = process.env.CLAUDE_OFFICE_PORT ? 'CLAUDE_OFFICE_PORT' : process.env.PORT ? 'PORT' : '';
const PORT_GIVEN = Number(argValue('--port')) || Number(process.env[PORT_ENV]) || 0;
const PORT_FROM = argValue('--port') ? '--port' : PORT_GIVEN ? PORT_ENV : '';
const PORT = PORT_GIVEN || Number(process.env.CLAUDE_OFFICE_DEFAULT_PORT) || 4777;
const PORT_TRIES = 10;
const OPEN_BROWSER = !args.includes('--no-open') && !process.env.NO_OPEN;
const POLL_MS = 250;
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const PROJECTS = path.join(CLAUDE_DIR, 'projects');
const PUBLIC = path.join(__dirname, '..', 'public');
const HISTORY_EVENTS = 300;
const MAX_INITIAL_BYTES = 40 * 1024 * 1024; // 세션 하나만 볼 때 처음에 읽는 양
const ALL_INITIAL_BYTES = 8 * 1024 * 1024; // 빌딩(여러 세션)에서 세션마다 처음에 읽는 양
const SUB_INITIAL_BYTES = 4 * 1024 * 1024; // 서브에이전트 기록
// 빌딩에 머무는 세션: 최근 30분 안에 움직인 세션 (--active나 CLAUDE_OFFICE_ACTIVE_MINUTES로 바꿀 수 있다)
const ACTIVE_MS = (Number(argValue('--active')) || Number(process.env.CLAUDE_OFFICE_ACTIVE_MINUTES) || 30) * 60 * 1000;
const SUB_IDLE_MS = 10 * 60 * 1000; // 이만큼 조용한 서브에이전트는 처음 화면에 띄우지 않는다
const MAX_SESSIONS = 12;
const MAX_HOOK_BYTES = 1024 * 1024;

// 사용자에게 '이렇게 실행하세요'라고 보여 줄 명령. 'claude-office'라는 이름은 npm에 다른 사람 패키지가 있어서
// 그대로 따라 치면 엉뚱한 프로그램이 돌아요. npx로 받았으면 그 주소로, 아니면 node server.js로 보여 준다.
// 지금 폴더가 사무실 폴더가 아니거나 absolute면 server.js를 전체 경로로 (화면에 보여 줄 때처럼 어디서 칠지 모를 때)
const SERVER_FILE = path.join(__dirname, '..', 'server.js');
// npx는 주소가 같으면 처음 받은 사본을 계속 쓰므로 버전을 붙인다 (README 방법 A와 같은 꼴, GitHub는 ?v=를 무시한다)
const NPX_URL = `https://github.com/holyrootx/claude-office/archive/refs/heads/main.tar.gz?v=${VERSION}`;
const NPX_COPY = /[\\/]_npx[\\/]/.test(path.dirname(SERVER_FILE)); // npx가 받아 둔 사본으로 도는 중
function runCmd(rest, absolute = false) {
  const root = path.dirname(SERVER_FILE);
  if (NPX_COPY) return `npx ${NPX_URL} ${rest}`;
  const here = !absolute && path.resolve(process.cwd()) === root;
  return `node ${here ? 'server.js' : JSON.stringify(SERVER_FILE)} ${rest}`;
}

// WSL(Windows 안의 Linux)인지. Windows에서 Claude Code를 WSL로 쓰는 사람이 많은데, 거기에는 보통 xdg-open이 없다
function isWsl(env = process.env, platform = process.platform, readRelease = () => fs.readFileSync('/proc/sys/kernel/osrelease', 'utf8')) {
  if (platform !== 'linux') return false;
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  try { return /microsoft/i.test(readRelease()); } catch { return false; }
}

// 기본 브라우저로 주소를 여는 명령 후보 [명령, 인자] (앞의 것이 없으면 다음 것으로).
// WSL에서는 Windows 쪽 브라우저를 PowerShell로 연다 (WSL2는 Windows의 localhost를 WSL로 이어 준다).
// 주소는 따옴표가 섞여도 깨지지 않게 PowerShell 명령째 인코딩한다. 전에는 xdg-open만 해 보고 말없이 못 열었다
function browserCommands(url, { platform = process.platform, wsl = isWsl() } = {}) {
  if (platform === 'win32') return [['cmd', ['/c', 'start', '""', url]]];
  if (platform === 'darwin') return [['open', [url]]];
  if (!wsl) return [['xdg-open', [url]]];
  const ps = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(`Start-Process '${String(url).replace(/'/g, "''")}'`, 'utf16le').toString('base64')];
  return [['powershell.exe', ps], ['/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', ps], ['wslview', [url]], ['xdg-open', [url]]];
}

module.exports = {
  args, argValue, argWords, argProblem, nearOption, envProblem, isWsl, browserCommands, VERSION, PORT_GIVEN, PORT_FROM, PORT, PORT_TRIES, OPEN_BROWSER, POLL_MS, CLAUDE_DIR, PROJECTS, PUBLIC,
  HISTORY_EVENTS, MAX_INITIAL_BYTES, ALL_INITIAL_BYTES, SUB_INITIAL_BYTES, ACTIVE_MS, SUB_IDLE_MS, MAX_SESSIONS, MAX_HOOK_BYTES, runCmd, NPX_COPY, OPTIONS,
};
