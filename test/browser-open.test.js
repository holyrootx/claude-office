// 켤 때 기본 브라우저로 여는 명령(lib/config.js browserCommands): WSL에서도 Windows 쪽 브라우저가 열린다.
// 전에는 Linux면 xdg-open만 해 봐서, 보통 xdg-open이 없는 WSL에서는 말없이 안 열렸다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isWsl, browserCommands } = require('../lib/config');

test('WSL 알아보기: 환경 변수나 커널 이름(microsoft)으로, Linux일 때만', () => {
  assert.equal(isWsl({ WSL_DISTRO_NAME: 'Ubuntu' }, 'linux'), true);
  assert.equal(isWsl({ WSL_INTEROP: '/run/WSL/1_interop' }, 'linux'), true);
  assert.equal(isWsl({}, 'linux', () => '5.15.153.1-microsoft-standard-WSL2'), true);
  assert.equal(isWsl({}, 'linux', () => '6.8.0-45-generic'), false);
  assert.equal(isWsl({}, 'linux', () => { throw new Error('없음'); }), false);
  assert.equal(isWsl({ WSL_DISTRO_NAME: 'Ubuntu' }, 'darwin'), false);
});

test('운영체제마다 여는 명령: Windows는 start, macOS는 open, Linux는 xdg-open', () => {
  const url = 'http://localhost:4777';
  assert.deepEqual(browserCommands(url, { platform: 'win32' }), [['cmd', ['/c', 'start', '""', url]]]);
  assert.deepEqual(browserCommands(url, { platform: 'darwin' }), [['open', [url]]]);
  assert.deepEqual(browserCommands(url, { platform: 'linux', wsl: false }), [['xdg-open', [url]]]);
});

test('WSL: Windows의 PowerShell로 열고(PATH에 없으면 전체 경로), 안 되면 wslview·xdg-open', () => {
  const url = "http://localhost:4777/?a=1&b='x'";
  const list = browserCommands(url, { platform: 'linux', wsl: true });
  assert.deepEqual(list.map(c => c[0]), ['powershell.exe', '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', 'wslview', 'xdg-open']);
  // 주소는 인코딩한 명령 안에 그대로 (따옴표는 PowerShell 꼴로 두 번)
  const [, args] = list[0];
  assert.equal(args[args.indexOf('-EncodedCommand') + 1] && Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le'), "Start-Process 'http://localhost:4777/?a=1&b=''x'''");
  assert.deepEqual(list[2], ['wslview', [url]]);
});
