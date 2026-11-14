// 명령줄 옵션 점검(lib/config.js argProblem): 오타는 조용히 넘기지 않고 무엇이 틀렸는지 알려 준다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { argProblem } = require('../lib/config');

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

test('쓸 수 있는 옵션은 다 --help에 나온다 (새 옵션을 넣고 도움말을 빠뜨리지 않게)', () => {
  const { execFileSync } = require('child_process');
  const path = require('path');
  const help = execFileSync(process.execPath, [path.join(__dirname, '..', 'server.js'), '--help']).toString();
  const { OPTIONS } = require('../lib/config');
  for (const opt of Object.keys(OPTIONS)) assert.ok(help.includes(opt), `${opt}가 도움말에 없어요`);
});
