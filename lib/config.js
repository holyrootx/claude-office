// 실행 옵션과 설정값. 명령줄(--port, --active, --no-open)과 환경 변수를 한곳에서 읽는다.
'use strict';

const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const argValue = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

// 아는 옵션. number는 뒤에 숫자를 받고, maybe(--journal)는 날을 붙여도 되고 안 붙여도 된다.
const OPTIONS = {
  '--port': 'number', '--active': 'number', '--journal': 'maybe',
  '--no-open': 0, '--background': 0, '--stop': 0, '--print-hooks': 0, '--install-hooks': 0, '--uninstall-hooks': 0, '--md': 0, '--help': 0, '-h': 0, '--version': 0, '-v': 0,
};

// 잘못 쓴 옵션을 찾아 무엇이 틀렸는지 돌려준다 (없으면 null).
// 오타(--prot 5000)를 모른 척 넘기면 엉뚱한 포트로 조용히 켜져서 왜 안 열리는지 알기 어렵다.
function argProblem(list = args) {
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const kind = OPTIONS[a];
    if (kind === undefined) {
      const [name, value] = a.split('=');
      if (OPTIONS[name] === 'number' && value) return `${name} ${value}처럼 띄어 써 주세요`;
      if (a.startsWith('--')) return `모르는 옵션이에요: ${a}`;
      continue;
    }
    if (kind === 'number') {
      const v = Number(list[i + 1]);
      const ok = a === '--port' ? Number.isInteger(v) && v > 0 && v < 65536 : v > 0;
      if (!ok) return `${a} 뒤에 ${a === '--port' ? '포트 번호를' : '분을'} 적어 주세요 (예: ${a} ${a === '--port' ? 4800 : 60})`;
      i++;
    } else if (kind === 'maybe' && list[i + 1] && !list[i + 1].startsWith('--')) i++;
  }
  return null;
}

const VERSION = require('../package.json').version;
// --port나 PORT로 직접 정했으면 그 포트만 쓰고, 아니면 4777부터 비어 있는 포트를 찾아 쓴다
// (CLAUDE_OFFICE_DEFAULT_PORT는 테스트가 실제 4777을 건드리지 않게 시작 번호를 바꿀 때 쓴다)
const PORT_GIVEN = Number(argValue('--port')) || Number(process.env.PORT) || 0;
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

module.exports = {
  args, argValue, argProblem, VERSION, PORT_GIVEN, PORT, PORT_TRIES, OPEN_BROWSER, POLL_MS, CLAUDE_DIR, PROJECTS, PUBLIC,
  HISTORY_EVENTS, MAX_INITIAL_BYTES, ALL_INITIAL_BYTES, SUB_INITIAL_BYTES, ACTIVE_MS, SUB_IDLE_MS, MAX_SESSIONS, MAX_HOOK_BYTES, runCmd, NPX_COPY,
};
