// 실행 옵션과 설정값. 명령줄(--port, --active, --no-open)과 환경 변수를 한곳에서 읽는다.
'use strict';

const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const argValue = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

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

module.exports = {
  args, argValue, VERSION, PORT_GIVEN, PORT, PORT_TRIES, OPEN_BROWSER, POLL_MS, CLAUDE_DIR, PROJECTS, PUBLIC,
  HISTORY_EVENTS, MAX_INITIAL_BYTES, ALL_INITIAL_BYTES, SUB_INITIAL_BYTES, ACTIVE_MS, SUB_IDLE_MS, MAX_SESSIONS, MAX_HOOK_BYTES,
};
