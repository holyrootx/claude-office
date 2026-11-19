// 진짜 브라우저(헤드리스 Chrome)로 화면을 띄워 보는 연기 테스트. 화면 코드(app.js 등)는 DOM이 있어야 돌아서
// 다른 테스트는 문법·이름만 보는데, 여기서는 실제로 불러와서 오류가 없는지, 로비·정보 카드·다시 보기가 되는지 본다.
// Chrome(또는 Chromium)이 없거나 Node에 WebSocket이 없으면(22 미만) 건너뛴다. 내 진짜 기록은 읽지 않는다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
function findChrome() {
  const list = [process.env.CHROME].filter(Boolean);
  if (process.platform === 'darwin') list.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium');
  else if (process.platform === 'win32') {
    for (const p of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) list.push(path.join(p, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  } else {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      const r = spawnSync('which', [name], { encoding: 'utf8' });
      if (r.status === 0) list.push(r.stdout.trim());
    }
  }
  return list.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } });
}
const CHROME = findChrome();
const skip = !CHROME ? 'Chrome이 없어요 (CHROME 환경 변수로 경로를 알려 주면 돌아요)' : typeof WebSocket !== 'function' ? 'Node 22 이상에서만 돌아요 (WebSocket)' : false;

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`${ms / 1000}초 안에 안 됐어요: ${what}`);
    await sleep(150);
  }
}

test('헤드리스 Chrome: 화면이 오류 없이 다 불러와지고, 로비 줄 → 정보 카드 → 다시 보기, 업무 일지·도움말·테마·폰 크기가 된다', { skip, timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-smoke-'));
  const procs = [];
  try {
    // 기록 하나: 내 말 → 파일 읽기 → 답
    const dir = path.join(tmp, 'claude', 'projects', '-tmp-shop');
    fs.mkdirSync(dir, { recursive: true });
    const t = s => new Date(Date.now() - 60000 + s * 1000).toISOString();
    const L = o => JSON.stringify({ cwd: '/tmp/shop', ...o });
    fs.writeFileSync(path.join(dir, 'abcdabcd-0000-0000-0000-00000000000a.jsonl'), [
      L({ type: 'user', uuid: 'u1', timestamp: t(0), message: { role: 'user', content: '로그인 고쳐 줘' } }),
      JSON.stringify({ type: 'last-prompt', lastPrompt: '로그인 고쳐 줘' }), // Claude Code가 처음부터 남기는 제목 줄
      L({ type: 'assistant', uuid: 'a1', timestamp: t(1), message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/tmp/shop/auth.ts' } }] } }),
      L({ type: 'user', uuid: 'r1', timestamp: t(2), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
      L({ type: 'assistant', uuid: 'a2', timestamp: t(3), message: { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '고쳤어요' }] } }),
    ].join('\n') + '\n');
    // 포트는 정하지 않고 시작 번호만 아무 데나 (쓰이고 있으면 다음 번호로 알아서 간다)
    const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'), CLAUDE_OFFICE_RUNTIME: path.join(tmp, 'rt.json'), NO_OPEN: '1', CLAUDE_OFFICE_PORT: '', PORT: '', CLAUDE_OFFICE_DEFAULT_PORT: String(40000 + Math.floor(Math.random() * 20000)) };
    const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env, stdio: ['ignore', 'pipe', 'ignore'] });
    procs.push(srv);
    let out = '';
    srv.stdout.on('data', d => { out += d; });
    const url = (await until(() => (out.match(/열렸어요 → (http:\/\/\S+)/) || [])[1], 15000, '사무실 켜기')).replace('localhost', '127.0.0.1');

    const prof = path.join(tmp, 'chrome');
    const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
    procs.push(chrome);
    const port = await until(() => { try { return fs.readFileSync(path.join(prof, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { return null; } }, 15000, 'Chrome 켜기');
    const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x => x.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    let id = 0;
    const pending = new Map(), problems = [];
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') problems.push(m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(m.params.args.map(a => a.value || a.description).join(' '));
    });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const key = async k => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k.length === 1 ? k : undefined });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k });
    };
    const js = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      const ex = r.result.exceptionDetails;
      if (ex) throw new Error((ex.exception && ex.exception.description) || ex.text); // 'Uncaught'만이 아니라 무슨 오류인지
      return r.result.result.value;
    };
    await send('Runtime.enable');
    // 화면이 연 실시간 연결(EventSource)을 붙잡아 둔다: 망가진 장면을 직접 흘려 넣어 보려고
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__es = []; window.EventSource = class extends window.EventSource { constructor(...a) { super(...a); window.__es.push(this); } };' });
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });

    await until(() => js('window.__officeReady === true'), 15000, '화면 코드를 끝까지 불러오기');
    const row = await until(() => js(`(document.querySelector('#lobby [data-floor]') || {}).textContent || ''`), 15000, '로비에 직원이 나오기');
    assert.match(row, /로그인 고쳐 줘/);
    await js(`document.querySelector('#lobby [data-floor]').click()`);
    await until(() => js(`!document.getElementById('card').hidden`), 5000, '정보 카드 열기');
    assert.match(await js(`document.getElementById('card').textContent`), /로그인 고쳐 줘/);
    await js(`document.querySelector('#card [data-act="replay"]').click()`);
    await until(() => js(`!document.getElementById('replayBar').hidden`), 10000, '다시 보기 시작');
    assert.match(await js(`document.getElementById('replayBar').getAttribute('aria-valuetext') || ''`), /^\d+% · /);
    await js(`document.getElementById('replayBtn').click()`); // 다시 보기 끝내고 실시간으로
    await until(() => js(`document.getElementById('replayBar').hidden`), 5000, '다시 보기 끝내기');

    // 업무 일지: J로 열고 W·M으로 주간·월간, Esc로 닫기
    const title = () => js(`document.getElementById('journal').hidden ? '' : document.getElementById('journalTitle').textContent`);
    await key('j');
    assert.match(await until(title, 8000, '업무 일지 열기'), /업무 일지/);
    await key('w');
    await until(async () => /주간 업무 일지/.test(await title()), 8000, '주간 일지');
    await key('m');
    await until(async () => /\d{4}년 \d{1,2}월 업무 일지/.test(await title()), 8000, '월간 일지');
    await key('Escape');
    await until(() => js(`document.getElementById('journal').hidden`), 3000, '업무 일지 닫기');
    // 도움말: ?로 열고 Esc로 닫기
    await key('?');
    await until(() => js(`!document.getElementById('help').hidden && document.getElementById('helpBody').textContent.includes('단축키')`), 3000, '도움말 열기');
    await key('Escape');
    await until(() => js(`document.getElementById('help').hidden`), 3000, '도움말 닫기');
    // 화면 밝기: 세 번 누르면 한 바퀴 돌아 처음으로
    const theme = () => js(`document.documentElement.dataset.theme || ''`);
    const first = await theme();
    for (let i = 0; i < 3; i++) await js(`document.getElementById('themeBtn').click()`);
    assert.equal(await theme(), first);
    // 글자 대비: 밝은·어두운 화면 모두 둘레(막대·패널·카드)의 글자가 배경과 4.5:1(큰 글자 3:1) 넘는지 (WCAG AA).
    // 색은 캔버스에 한 점 칠해 읽어서 color-mix()·color(srgb …)도 그대로 잰다.
    // 사무실 그림(바닥·캐릭터·표지판·화이트보드·말풍선)만 빼고, 그 위에 뜨는 정보 카드·가운데 안내는 잰다 (안 보이는 안내는 빼고)
    const lowContrast = () => js(`(() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      const rgba = c => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); return [...cx.getImageData(0, 0, 1, 1).data]; };
      const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      // 반투명 배경(안내 띠 rgba(…, .9) 등)은 아래 배경과 섞어서, 화면에 보이는 그대로의 배경색을 만든다
      const bgOf = el => {
        const layers = [];
        for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3]) layers.push(c); if (c[3] === 255) break; }
        let out = layers.length && layers[layers.length - 1][3] === 255 ? layers.pop() : rgba(getComputedStyle(document.documentElement).backgroundColor || '#fff');
        if (out[3] !== 255) out = [255, 255, 255, 255];
        while (layers.length) { const c = layers.pop(), a = c[3] / 255; out = [0, 1, 2].map(i => c[i] * a + out[i] * (1 - a)).concat(255); }
        return out;
      };
      const invisible = el => { for (let e = el; e; e = e.parentElement) if (Number(getComputedStyle(e).opacity) < 0.1) return true; return false; };
      const bad = [];
      for (const el of document.querySelectorAll('body *')) {
        if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || !el.getClientRects().length || el.closest('svg, #actors, #signs, #floor, .board, .me-tag, .user-bubble, [hidden], .sr-only') || invisible(el)) continue;
        const fg = rgba(cs.color), bg = bgOf(el);
        if (fg[3] < 200) continue; // 일부러 흐리게 한 글(비활성 등)은 빼고
        const a = lum(fg), b = lum(bg), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const big = parseFloat(cs.fontSize) >= 18.66 || (parseFloat(cs.fontSize) >= 14 && Number(cs.fontWeight) >= 700);
        if (ratio < (big ? 3 : 4.5)) bad.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]) + ' ' + ratio.toFixed(2) + ' "' + el.textContent.trim().slice(0, 16) + '"');
      }
      return bad;
    })()`);
    await js(`document.getElementById('card').hidden || document.querySelector('#card [data-act="close"]').click()`);
    await js(`document.querySelector('#lobby [data-floor]').click()`); // 정보 카드를 연 채로도 잰다
    await until(() => js(`!document.getElementById('card').hidden`), 5000, '대비를 잴 정보 카드 열기');
    for (const scheme of ['light', 'dark']) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await sleep(300);
      assert.deepEqual(await lowContrast(), [], `${scheme === 'light' ? '밝은' : '어두운'} 화면에서 대비가 낮은 글자`);
    }
    // 폰 크기에서도 로비 줄 → 정보 카드
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
    await js(`document.getElementById('card').hidden = true; document.querySelector('#lobby [data-floor]').click()`);
    await until(() => js(`!document.getElementById('card').hidden`), 5000, '폰 크기에서 정보 카드 열기');
    assert.equal(await js(`document.documentElement.scrollWidth <= innerWidth`), true, '폰 크기에서 옆으로 넘치지 않는다');

    // 세션 하나를 그리다 오류가 나도 다른 장면은 들어온다 (전에는 같이 온 묶음이 통째로 빠졌고, 첫 장면이면 빌딩이 비었다)
    const seen = problems.length;
    const pour = (type, data) => js(`window.__es[window.__es.length - 1].dispatchEvent(new MessageEvent('${type}', { data: ${JSON.stringify(JSON.stringify(data))} }))`);
    const sid = 'abcdabcd-0000-0000-0000-00000000000a';
    await pour('events', { updates: [{ sid, events: 5 }, { sid, events: [{ k: 'say', ts: Date.now(), text: '망가진 장면 뒤에도 들어와요', final: true }] }] });
    await until(() => js(`document.getElementById('feed').textContent.includes('망가진 장면 뒤에도 들어와요')`), 3000, '망가진 장면과 같이 온 장면');
    await pour('hello', { sessions: [
      { sid: 'eeeeeeee-0000-0000-0000-00000000000b', session: { project: 'broken', title: '망가진 세션', cwd: '/tmp/broken' }, history: 5 },
      { sid: 'ffffffff-0000-0000-0000-00000000000c', session: { project: 'blog', title: '글 다듬기', cwd: '/tmp/blog' }, history: [] },
    ] });
    const lobby = await until(() => js(`document.getElementById('lobby').textContent`), 3000, '망가진 세션과 같이 온 세션');
    assert.match(lobby, /글 다듬기/);
    assert.doesNotMatch(lobby, /망가진 세션/);
    const broke = problems.splice(seen);
    assert.equal(broke.length, 2, broke.join('\n'));
    for (const p of broke) assert.match(p, /^\[세션\] /); // 어느 세션에서 났는지 남긴다
    ws.close();
    assert.deepEqual(problems, [], '화면에서 난 오류');
  } finally {
    for (const p of procs) if (p.exitCode === null) p.kill();
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
