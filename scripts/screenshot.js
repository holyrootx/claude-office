#!/usr/bin/env node
// README 화면(docs/screenshot.png)을 데모로 다시 찍는다.
// 실제 세션 제목이 찍히지 않게, 빈 기록 폴더로 서버를 따로 띄워서 데모만 찍는다.
// 필요한 것: Chrome이나 Chromium (못 찾으면 CHROME 환경 변수로 경로를 알려 주세요)
//   npm run screenshot                     → 데모 14초 지점 (인턴이 보고하는 장면), docs/screenshot.png
//   npm run screenshot -- --at 22 --out x.png
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const runtime = require('../lib/runtime');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const AT = Number(opt('--at', 14));
const OUT = path.resolve(opt('--out', path.join(ROOT, 'docs', 'screenshot.png')));
const SIZE = opt('--size', '1680,945');

function findChrome() {
  const list = [process.env.CHROME].filter(Boolean);
  if (process.platform === 'darwin') {
    list.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else if (process.platform === 'win32') {
    const pf = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const p of pf) list.push(path.join(p, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  } else {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      const r = spawnSync('which', [name], { encoding: 'utf8' });
      if (r.status === 0) list.push(r.stdout.trim());
    }
  }
  return list.find(p => p && fs.existsSync(p));
}

const freePort = () => new Promise(resolve => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const chrome = findChrome();
  if (!chrome) {
    console.error('  ⚠ Chrome이나 Chromium을 찾지 못했어요. CHROME 환경 변수로 실행 파일 경로를 알려 주세요.');
    process.exit(1);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-shot-'));
  fs.mkdirSync(path.join(tmp, 'claude', 'projects'), { recursive: true });
  const port = await freePort();
  const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'), CLAUDE_OFFICE_RUNTIME: path.join(tmp, 'runtime.json'), NO_OPEN: '1' };
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--port', String(port)], { env, stdio: 'ignore' });
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) { up = !!(await runtime.health(port)); if (!up) await sleep(100); }
    if (!up) throw new Error('사무실 서버가 켜지지 않았어요');
    console.log(`  📸 데모 ${AT}초 지점을 찍는 중… (${SIZE.replace(',', '×')})`);
    const r = spawnSync(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${path.join(tmp, 'chrome')}`, `--window-size=${SIZE}`, `--virtual-time-budget=${AT * 1000}`,
      `--screenshot=${OUT}`, `http://localhost:${port}/?demo`,
    ], { stdio: 'ignore', timeout: 120000 });
    if (r.status !== 0 || !fs.existsSync(OUT)) throw new Error('Chrome이 화면을 찍지 못했어요');
    console.log(`  ✅ ${path.relative(process.cwd(), OUT)} (${Math.round(fs.statSync(OUT).size / 1024)}KB)`);
  } catch (e) {
    console.error('  ⚠ ' + e.message);
    process.exitCode = 1;
  } finally {
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
