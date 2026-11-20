#!/usr/bin/env node
// Claude 사무실 — Claude Code 세션 기록(~/.claude/projects/**/*.jsonl)을 0.25초마다 따라 읽어서
// 브라우저(SSE)로 정규화된 활동 이벤트를 보내는 작은 서버. 의존성 없음 (Node 18+).
//
//   node server.js               → http://localhost:4777 (브라우저 자동으로 열림)
//   node server.js --port 4800   → 다른 포트
//   node server.js --no-open     → 브라우저 자동 열기 끄기
//   node server.js --background  → 터미널 없이 뒤에서 켜기 (끌 때는 --stop)
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const runtime = require('./lib/runtime');
const {
  args, argValue, argWords, argProblem, browserCommands, envProblem, VERSION, PORT_GIVEN, PORT_FROM, PORT, PORT_TRIES, OPEN_BROWSER, POLL_MS, CLAUDE_DIR, PROJECTS, PUBLIC, MAX_HOOK_BYTES, ACTIVE_MS, runCmd, NPX_COPY,
} = require('./lib/config');
// 안내에 보여 줄 설정 파일 (CLAUDE_CONFIG_DIR로 폴더를 바꿔 쓰면 그 경로, 홈 폴더 아래면 ~로 줄여서)
const SETTINGS_SHOWN = (f => (f.startsWith(os.homedir() + path.sep) ? '~' + f.slice(os.homedir().length) : f))(path.join(CLAUDE_DIR, 'settings.json'));
const { hooksInfo, hooksHint, ourHooks, installHooks, uninstallHooks } = require('./lib/hookcheck');
const normalize = require('./lib/normalize');
const { roomRules, ROOM_CONFIG } = normalize;
const { scanSessions, describe, activeAt, insideProjects, waits, endedAt, sweepStale, onHook, Follower, replayOf, journal } = require('./lib/sessions');
const {
  journalText, journalMarkdown, parseDay, parseWeek, weekRange, weekTitle, weekSummary, weekText, weekMarkdown,
  parseMonth, monthRange, monthTitle, byWeek, monthText, monthMarkdown, pastOffset, apiDay, dayProblem,
} = require('./lib/report');
// 여러 날(한 주·한 달)의 날마다 일지 (from·to: 오늘이 0, 어제가 -1, project: 그 프로젝트만)
// 파일은 한 번만 읽고 날마다 나눠 센다 (읽은 기록은 lib/sessions.js가 요청 사이에도 들고 있는다)
async function weekDays({ from, to }, project = '', pick = {}) {
  const days = [];
  for (let d = from; d <= to; d++) days.push(await journal(d, project, pick));
  return days;
}
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  Claude 사무실 ${VERSION} — Claude Code가 지금 뭘 하는지 캐릭터로 보여 줘요.

  사용법: ${runCmd('[옵션]')}   (플러그인이면 Claude Code에서 /office:open)

  켜기·끄기
    --port <번호>        사용할 포트 (기본 4777, 쓰이고 있으면 4778·4779… 차례로.
                         직접 정하면 그 포트만 써요. 환경 변수 CLAUDE_OFFICE_PORT로도 돼요)
    --no-open            브라우저를 자동으로 열지 않기
    --background         터미널 창 없이 뒤에서 켜기 (이미 켜져 있으면 화면만 열기,
                         켜져 있는 게 예전 버전이면 끄고 새 버전으로)
    --stop               뒤에서 켜 둔 사무실 끄기
    --active <분>        빌딩에 머무는 시간 (기본 30분: 그동안 조용하면 퇴근, 다시 움직이면 출근)

  업무 일지 (서버를 켜지 않고 터미널에)
    --journal [날]       오늘, 또는 어제·그저께·3일 전·금요일·지난 주 금요일·10월 31일·2026-10-31
    --journal 이번 주    한 주를 날마다·프로젝트마다 (지난 주·2주 전도)
    --journal 이번 달    한 달을 주마다·프로젝트마다 (지난 달·10월도)
    --md                 위 일지를 슬랙·노션에 붙여 넣을 마크다운으로
    --project <이름>     위 일지를 이름이 든 프로젝트만 (예: --journal 지난 주 --project blog)

  hooks (권한 확인 대기·대화 압축 중·닫으면 바로 퇴근하는 모습까지 보기)
    --install-hooks      ${SETTINGS_SHOWN}에 넣기 (다른 hooks는 그대로, 전 내용은 남겨요)
    --uninstall-hooks    넣어 둔 사무실 hooks만 빼기
    --print-hooks        설정을 출력만 하기 (직접 합치고 싶을 때)

  그 밖에
    -v, --version        버전
    -h, --help           이 도움말

  환경 변수로도 돼요: CLAUDE_OFFICE_PORT=4800 · NO_OPEN=1 · CLAUDE_OFFICE_ACTIVE_MINUTES=60 (자세한 건 README의 실행 옵션)

  예: ${runCmd('--port 4800')}
      ${runCmd('--journal 지난 주 --md')}
`);
  process.exit(0);
}
if (args.includes('--version') || args.includes('-v')) {
  console.log(`claude-office ${VERSION}`);
  process.exit(0);
}

// hook 요청은 실행 정보 파일(lib/runtime.js)을 읽을 수 있는 쪽, 즉 이 컴퓨터의 나만 보낼 수 있다
const TOKEN = crypto.randomBytes(16).toString('hex');

// ───────────────────────── HTTP ─────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
// 화면은 세션 기록(웹 페이지 내용, 명령 출력 등이 섞인)을 보여 주니까, 혹시 글자 처리를 빠뜨린 곳이 있어도
// 이 서버의 스크립트 파일만 돌게 막아 둔다. 글꼴만 Google Fonts에서 받는다.
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data:", "connect-src 'self'",
  "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');
// 화면(html)이 아닌 응답(API의 JSON·마크다운, 오류 글)은 문서로 열려도 아무것도 돌지 않게 한다.
// 마크다운 일지에는 주소에 적은 프로젝트 이름(?project=)이 그대로 들어가서, 다른 사이트가 이 주소로 보내도
// 브라우저가 HTML로 짐작해 스크립트를 돌리는 일이 없게 (화면 파일은 아래에서 CSP로 바꿔 단다)
const API_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox" };
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

// 다른 사이트(다른 포트의 localhost도)의 페이지가 브라우저로 보낸 요청은 받지 않는다. 내용을 읽을 수는 없지만
// 그림 태그 하나로 실시간 연결을 열어 둔 채 0.25초마다 기록을 읽게 하거나, 몇 년 치 월간 일지를 차례로 훑게 해서
// 내 컴퓨터를 바쁘게 할 수 있었다. 링크를 눌러 이 화면을 여는 것(창 하나를 통째로 여는 이동)은 그대로 받는다.
// 브라우저가 아닌 hook·터미널 명령(--stop 등)은 이 머리글을 보내지 않아서 상관없다
function fromOtherSite(req) {
  const site = req.headers['sec-fetch-site'];
  if (site !== 'cross-site' && site !== 'same-site') return false;
  return !(req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document');
}

function json(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function sameToken(t) {
  const a = Buffer.from(String(t || '')), b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// hook 알림과 끄기 요청. 실행 정보 파일의 토큰을 아는 쪽(같은 컴퓨터의 나)만 보낼 수 있다.
let hookHeard = false; // 이번에 켠 뒤로 hook 알림을 받은 적이 있는지
function handlePost(req, res, pathname) {
  if (!sameToken(req.headers['x-office-token'])) { res.writeHead(403); return res.end(); }
  if (pathname === '/api/shutdown') {
    closing = true;
    runtime.remove(process.pid); // 답하기 전에 지워서, 꺼지는 사이에 다른 요청이 이 서버를 찾지 않게
    res.writeHead(200);
    res.end('bye');
    return setTimeout(() => process.exit(0), 50);
  }
  if (pathname !== '/hook') { res.writeHead(404); return res.end(); }
  const chunks = [];
  let size = 0;
  req.on('data', c => {
    size += c.length;
    if (size <= MAX_HOOK_BYTES) return chunks.push(c);
    res.writeHead(413);
    res.end();
    req.destroy();
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    res.writeHead(204);
    res.end();
    hookHeard = true;
    try { onHook(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { console.error('[hook]', e.message); }
  });
}

// 켜 둔 사이에 사무실 프로그램 파일이 바뀌었는지 (git pull 등). 서버 쪽(server.js·lib·package.json)이 바뀌면 다시 켜야 하고,
// 화면 쪽(public)만 바뀌면 새로 고치면 된다. 화면이 15초마다 세션 목록을 받을 때 같이 알려 준다.
function newest(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isDirectory()) return st.mtimeMs;
    return fs.readdirSync(p).reduce((m, f) => Math.max(m, newest(path.join(p, f))), 0);
  } catch {
    return 0;
  }
}
const serverStamp = () => Math.max(newest(__filename), newest(path.join(__dirname, 'lib')), newest(path.join(__dirname, 'package.json')));
const SERVER_STAMP = serverStamp();
const codeInfo = () => ({ restart: serverStamp() > SERVER_STAMP, ui: newest(PUBLIC) });
// 다시 켜는 명령: 플러그인이면 Claude Code에서 /office:open, 아니면 지금 켠 방법 그대로 (npx면 버전 붙은 주소, 아니면 server.js 전체 경로).
// npm의 'claude-office'는 다른 사람 패키지라 'npx claude-office'라고 하면 안 된다
const START_CMD = path.resolve(__dirname).startsWith(path.resolve(CLAUDE_DIR, 'plugins') + path.sep) ? 'Claude Code에서 /office:open' : runCmd('', true).trim();

// 요청 하나를 처리하다 예상 못 한 오류가 나도 서버 전체가 꺼지지 않게 그 요청에만 500으로 답한다.
// (다른 사이트도 그림 태그 하나로 localhost 주소를 부를 수 있어서, 요청 하나로 꺼지면 보던 화면이 모두 끊긴다)
const server = http.createServer((req, res) => {
  try { handle(req, res); } catch (e) {
    console.error('[요청]', req.url, e.message);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

function handle(req, res) {
  for (const [k, v] of Object.entries(API_HEADERS)) res.setHeader(k, v); // writeHead에 준 머리글이 있으면 그쪽이 이긴다
  // DNS 리바인딩 막기: 다른 사이트 주소로 들어온 요청은 받지 않는다
  if (!LOCAL_HOST.test(req.headers.host || '')) { res.writeHead(403); return res.end('forbidden'); }
  if (fromOtherSite(req)) { res.writeHead(403); return res.end('forbidden'); }
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
  if (req.method === 'POST') return handlePost(req, res, url.pathname);

  if (url.pathname === '/api/health') return json(res, { app: 'claude-office', version: VERSION, pid: process.pid });
  // hooks가 켜져 있는지 (도움말 창 맨 위에 보여 준다)
  if (url.pathname === '/api/hooks') return json(res, hooksInfo(CLAUDE_DIR, __dirname, hookHeard, true));

  if (url.pathname === '/api/sessions') {
    const all = scanSessions();
    // 파일이 바뀐 차례로 40개를 고른 뒤 마지막 기록 시각 차례로 다시 세워 30개 (장부 줄만 붙은 옛 세션이
    // 어제 일한 세션들보다 위에 오지 않게. 마지막 기록은 파일이 바뀐 때보다 늦을 수 없어서 40개 안에서 고르면 된다)
    const top = all.slice(0, 40).sort((a, b) => activeAt(b) - activeAt(a)).slice(0, 30);
    // 화면에서 고정해 둔 세션은 오래돼서 30개 밖으로 밀려도 목록에 남긴다
    const keep = url.searchParams.get('keep');
    if (keep && insideProjects(keep)) {
      const k = all.find(x => x.file === path.resolve(keep));
      if (k && !top.includes(k)) top.push(k);
    }
    sweepStale(); // 꺼진 Claude Code가 남긴 🔐는 지운다
    // waiting: 권한 확인 대기(🔐), ended: Claude Code를 닫은 시각(🚪, 닫았다는 hook을 받았고 그 뒤로 이어 하지 않았을 때)
    const list = top.map(s => {
      const sid = path.basename(s.file, '.jsonl');
      // active: 마지막으로 시각이 적힌 기록 (장부 줄만 붙은 옛 세션이 '방금'으로 보이지 않게, 목록의 '… 전'에 쓴다)
      const active = activeAt(s);
      return { ...describe(s), active, waiting: waits.has(sid), ended: endedAt(sid, active) };
    });
    // activeMinutes: 빌딩에 머무는 시간(--active). 화면의 '최근 N분' 글자에 쓴다
    // start: 사무실이 꺼졌을 때 화면이 '다시 켜려면 …'으로 보여 줄 명령 (꺼진 뒤에는 물어볼 수 없어서 미리 받아 둔다)
    return json(res, { root: PROJECTS, activeMinutes: ACTIVE_MS / 60000, sessions: list, code: codeInfo(), start: START_CMD });
  }

  if (url.pathname === '/api/journal') {
    // ?day=-1 (어제) 또는 ?day=2026-10-31. 없으면 오늘
    // ?format=md면 슬랙·노션에 붙여 넣을 마크다운 글로. JSON에도 같은 마크다운을 md로 실어 보낸다
    // (화면이 📋 복사용으로 같은 일지를 한 번 더 모으지 않게)
    const md = url.searchParams.get('format') === 'md';
    const project = url.searchParams.get('project') || ''; // 이 이름이 든 프로젝트만
    // 화면의 '이 프로젝트만': 이름이 꼭 같고(exact) 그 폴더(cwd)의 프로젝트만
    const pick = { exact: url.searchParams.get('exact') === '1', cwd: url.searchParams.get('cwd') || '' };
    const fail = e => {
      console.error('[journal]', e.message);
      res.writeHead(500);
      res.end();
    };
    // 없는 날(13월 45일)·앞날·너무 먼 옛날을 물으면 엉뚱한 날 일지 대신 무엇이 틀렸는지 알려 준다
    const bad = text => {
      res.writeHead(400, { 'Content-Type': md ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(md ? text : JSON.stringify({ error: text }));
    };
    // ?month=0 (이번 달) · -1 (지난 달) …: 한 달을 주마다·프로젝트마다 모아서
    if (url.searchParams.has('month')) {
      const month = pastOffset(url.searchParams.get('month'), 'month');
      if (month == null) return bad('어느 달인지 모르겠어요: month=0(이번 달), -1(지난 달)처럼 10년 안으로 적어 주세요');
      const r = monthRange(month);
      weekDays(r, project, pick).then(days => {
        if (md) {
          res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end(monthMarkdown(days, r.month));
        }
        json(res, { month, today: month === 0, title: monthTitle(days, r.month), weeks: byWeek(days), days: days.length, ...weekSummary(days), md: monthMarkdown(days, r.month) });
      }, fail);
      return;
    }
    // ?week=0 (이번 주) · -1 (지난 주) …: 한 주를 날마다·프로젝트마다 모아서
    if (url.searchParams.has('week')) {
      const week = pastOffset(url.searchParams.get('week'), 'week');
      if (week == null) return bad('어느 주인지 모르겠어요: week=0(이번 주), -1(지난 주)처럼 10년 안으로 적어 주세요');
      weekDays(weekRange(week), project, pick).then(days => {
        if (!md) {
          const daysOut = days.map(j => ({ since: j.since, workedMs: (j.totals && j.totals.workedMs) || 0, tools: (j.totals && j.totals.tools) || 0 }));
          return json(res, { week, today: week === 0, title: weekTitle(days), days: daysOut, ...weekSummary(days), md: weekMarkdown(days) });
        }
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(weekMarkdown(days));
      }, fail);
      return;
    }
    const day = apiDay(url.searchParams.get('day'));
    if (day == null) return bad('어느 날인지 모르겠어요: day=0(오늘), -1(어제)이나 2026-10-31처럼, 앞날이 아닌 10년 안의 날로 적어 주세요');
    journal(day, project, pick).then(j => {
      if (!md) return json(res, { ...j, md: journalMarkdown(j) });
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(journalMarkdown(j));
    }, fail);
    return;
  }

  if (url.pathname === '/api/replay') {
    const file = url.searchParams.get('file') || '';
    if (!insideProjects(file)) { res.writeHead(400); return res.end('bad file'); }
    replayOf(path.resolve(file)).then(r => {
      if (!r) { res.writeHead(404); return res.end('not found'); }
      json(res, r);
    }, e => {
      console.error('[replay]', e.message);
      res.writeHead(500);
      res.end();
    });
    return;
  }

  if (url.pathname === '/api/stream') {
    const want = url.searchParams.get('file') || 'all';
    if (want !== 'all' && want !== 'auto' && !insideProjects(want)) {
      res.writeHead(400);
      return res.end('bad file');
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 1500\n\n');
    const f = new Follower(res, want);
    req.on('close', () => f.close());
    return;
  }

  let rel;
  try { rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, ''); } catch {
    res.writeHead(400);
    return res.end('bad request');
  }
  // 파일 이름에 NUL(%00)이 있으면 fs가 바로 오류를 던진다 (전에는 이 요청 하나로 서버가 꺼졌다)
  if (rel.includes('\0')) { res.writeHead(400); return res.end('bad request'); }
  const file = path.join(PUBLIC, rel);
  const inside = path.relative(PUBLIC, file);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (path.extname(file) === '.html') Object.assign(headers, { 'Content-Security-Policy': CSP, 'Referrer-Policy': 'no-referrer' });
    res.writeHead(200, headers);
    res.end(body);
  });
}

// 후보 명령을 차례로: 없는 명령(ENOENT)이면 다음 것으로. 다 안 되면 그만둔다 (주소는 콘솔에 나와 있다)
function openBrowser(url, list = browserCommands(url)) {
  const [next, ...rest] = list;
  if (!next) return;
  try {
    spawn(next[0], next[1], { stdio: 'ignore', detached: true, windowsVerbatimArguments: true }).on('error', () => openBrowser(url, rest)).unref();
  } catch { openBrowser(url, rest); }
}

// ───────────────────────── 실행 방법 ─────────────────────────
let closing = false;

// 같은 포트를 [::1]에도 연다. 브라우저는 localhost를 [::1]로 먼저 찾아가는데, 맥은 AirPlay 수신 모드가
// 모든 주소의 5000·7000번을 잡고 있어서 127.0.0.1에만 열면 localhost:5000이 AirPlay로 가서 403이 난다.
// IPv6가 없으면 localhost가 127.0.0.1로만 가니 그대로 괜찮다. 다른 프로그램이 [::1]의 그 포트를 쓰고 있으면
// false → 주소를 127.0.0.1로 알려 준다.
function alsoOnV6(port) {
  return new Promise(resolve => {
    const v6 = http.createServer(server.listeners('request')[0]);
    v6.on('error', e => resolve(e.code !== 'EADDRINUSE'));
    v6.listen(port, '::1', () => resolve(true));
  });
}
function serve() {
  let port = PORT;
  server.on('error', async e => {
    if (e.code === 'EADDRINUSE') {
      const url = `http://localhost:${port}`;
      const running = await runtime.health(port);
      if (running) {
        console.log(`\n  🏢 Claude 사무실이 이미 켜져 있어요 → ${url}`);
        if (runtime.older(running.version, VERSION)) {
          console.log(`     켜져 있는 건 예전 버전(${running.version})이에요. 새 버전(${VERSION})으로 바꾸려면 그 사무실을 끄고(--stop이나 그 터미널에서 Ctrl+C) 다시 실행해 주세요.`);
        }
        console.log('');
        if (OPEN_BROWSER) openBrowser(url);
        process.exit(0);
      }
      // 포트를 직접 정하지 않았으면 다음 번호로 다시 해 본다
      if (!PORT_GIVEN && port < PORT + PORT_TRIES - 1) return server.listen(++port, '127.0.0.1');
      console.log(PORT_GIVEN
        ? `\n  ⚠ ${port}번 포트를 다른 프로그램이 쓰고 있어요.\n    다른 포트로 실행하려면: ${runCmd(`--port ${port + 1}`)}\n`
        : `\n  ⚠ ${PORT}~${port}번 포트를 모두 다른 프로그램이 쓰고 있어요.\n    비어 있는 포트를 직접 정해 주세요: ${runCmd('--port 4800')}\n`);
    } else {
      console.error(e);
    }
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', async () => {
    const url = `http://${(await alsoOnV6(port)) ? 'localhost' : '127.0.0.1'}:${port}`;
    if (port !== PORT) console.log(`\n  ℹ ${PORT}번 포트를 다른 프로그램이 쓰고 있어서 ${port}번으로 열었어요.`);
    const info = { pid: process.pid, port, token: TOKEN, version: VERSION };
    try {
      runtime.write(info);
    } catch (e) {
      console.log(`  ⚠ 실행 정보 파일을 쓰지 못해서 hooks 연동은 꺼져 있어요 (${e.message})`);
    }
    // 실행 정보 파일이 지워지면(며칠 켜 두는 사이 임시 폴더가 정리되는 등) hooks가 이 서버를 못 찾는다.
    // 3초마다 보고, 없으면 다시 쓴다. 다른 사무실이 자기 것을 써 두었으면 건드리지 않는다.
    setInterval(() => {
      if (closing || runtime.read()) return;
      try { runtime.write(info); } catch { /* 다음에 다시 */ }
    }, 3000).unref();
    process.on('exit', () => runtime.remove(process.pid));
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));
    console.log(`\n  🏢 Claude 사무실이 열렸어요 → ${url}`);
    if (portNote()) console.log(portNote());
    console.log(`  📂 세션 기록 폴더: ${PROJECTS}${fs.existsSync(PROJECTS) ? '' : '  (아직 없음 — claude를 한 번 실행하면 생겨요)'}`);
    const rules = roomRules.get(true);
    if (rules.length) console.log(`  🗂  내 방 설정 ${rules.length}개를 읽었어요 (${ROOM_CONFIG})`);
    const hint = hooksHint(CLAUDE_DIR, __dirname);
    if (hint) console.log(hint);
    // npx는 같은 주소면 처음 받은 사본을 계속 써서, 새 버전이 저절로 받아지지 않는다
    if (NPX_COPY) console.log(`  ℹ npx가 받아 둔 ${VERSION} 사본이에요. 같은 주소로는 새 버전을 받지 않으니, 새 버전은 README 방법 A의 최신 명령(?v= 숫자가 바뀐 것)으로 실행하세요.`);
    console.log(`  ⏱  ${POLL_MS}ms마다 최신 세션을 따라 읽는 중… (끄려면 Ctrl+C)\n`);
    if (OPEN_BROWSER) openBrowser(url);
  });
}

// 다른 앱용일 수도 있는 환경 변수 PORT를 따라 켰으면 알려 준다 (켜는 터미널과 /office:open 결과에)
const portNote = () => (PORT_FROM === 'PORT'
  ? `  ℹ 환경 변수 PORT=${PORT}를 따라 이 포트로 열었어요. 개발 중인 다른 앱의 PORT라면 그 앱이 이 포트를 못 쓰니, 사무실 포트는 CLAUDE_OFFICE_PORT=4777처럼 따로 정해 주세요.`
  : '');

// 터미널 창 없이 뒤에서 켠다. 이미 켜져 있으면 화면만 연다. (플러그인의 /office:open이 쓰는 방법)
// 켜져 있는 사무실 { port, version, pid }. 실행 정보 파일을 먼저 보고, 없거나 맞지 않으면 쓸 수 있는 포트에 차례로 물어본다.
async function findRunning() {
  const rt = runtime.read();
  const at = async p => { const h = await runtime.health(p); return h && { ...h, port: p }; };
  const first = rt && (await at(rt.port));
  if (first) return first;
  const ports = PORT_GIVEN ? [PORT] : Array.from({ length: PORT_TRIES }, (_, i) => PORT + i);
  for (const p of ports) { const h = await at(p); if (h) return h; }
  return null;
}

// 켜져 있는 사무실이 이 사무실보다 예전 버전이면 끈다 (플러그인을 업데이트해도 예전 서버가 계속 돌던 것).
// 끄면 그 포트를, 끄지 못하면(내가 켠 게 아니라 토큰을 모르면) 0을 준다.
async function stopOlder(found) {
  const rt = runtime.read();
  const r = rt && rt.port === found.port && (await runtime.request(found.port, 'POST', '/api/shutdown', { token: rt.token }));
  if (!r || r.status !== 200) return 0;
  for (let i = 0; i < 20 && (await runtime.health(found.port)); i++) await new Promise(res => setTimeout(res, 150));
  await new Promise(res => setTimeout(res, 150)); // 포트가 풀릴 틈
  return found.port;
}

// 뒤에서 켠 서버가 남긴 출력의 마지막 몇 줄
function logTail(n = 6) {
  try {
    return fs.readFileSync(runtime.LOG, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(-n);
  } catch {
    return [];
  }
}

async function startBackground() {
  const found = await findRunning();
  let samePort = 0;
  if (found && runtime.older(found.version, VERSION)) {
    samePort = await stopOlder(found);
    if (samePort) console.log(`  🔄 켜져 있던 사무실이 예전 버전(${found.version})이라 끄고 새 버전(${VERSION})으로 다시 켤게요.`);
  }
  if (found && !samePort) {
    const url = `http://localhost:${found.port}`;
    console.log(`  🏢 Claude 사무실이 이미 켜져 있어요 → ${url}`);
    if (runtime.older(found.version, VERSION)) console.log(`     켜져 있는 건 예전 버전(${found.version})이에요. 새 버전(${VERSION})으로 바꾸려면 그 사무실을 끄고 다시 켜 주세요.`);
    if (OPEN_BROWSER) openBrowser(url);
    return;
  }
  // 예전 사무실을 껐으면 같은 포트로 켠다 (열려 있던 화면이 그대로 다시 붙는다)
  const portArgs = samePort && !PORT_GIVEN ? ['--port', String(samePort)] : [];
  const childArgs = [__filename, ...args.filter(a => a !== '--background' && a !== '--no-open'), ...portArgs, '--no-open'];
  // 출력은 버리지 않고 기록 파일에 남긴다 (켜지 못했을 때 이유를 보여 주려고)
  let out = 'ignore';
  try { out = fs.openSync(runtime.LOG, 'w', 0o600); } catch { /* 기록 없이 켠다 */ }
  const child = spawn(process.execPath, childArgs, { detached: true, stdio: ['ignore', out, out], windowsHide: true });
  if (typeof out === 'number') fs.closeSync(out);
  let exited = false;
  child.on('exit', () => { exited = true; });
  child.unref();
  for (let i = 0; i < 40 && !exited; i++) {
    await new Promise(r => setTimeout(r, 150));
    const rt = runtime.read();
    if (rt && rt.pid === child.pid) {
      const url = `http://localhost:${rt.port}`;
      console.log(`  🏢 Claude 사무실을 뒤에서 켰어요 → ${url}`);
      if (portNote()) console.log(portNote());
      console.log(`     끄려면: node "${__filename}" --stop`);
      if (OPEN_BROWSER) openBrowser(url);
      return;
    }
  }
  const tail = logTail();
  console.log(`  ⚠ 사무실을 켜지 못했어요.${tail.length ? ' 사무실이 남긴 말:' : ''}`);
  for (const l of tail) console.log('     ' + l);
  console.log(`     터미널에서 node "${__filename}" 로 직접 실행하면 자세히 볼 수 있어요.`);
  process.exitCode = 1;
}

async function stopServer() {
  const rt = runtime.read();
  const r = rt && (await runtime.request(rt.port, 'POST', '/api/shutdown', { token: rt.token }));
  if (r && r.status === 200) return console.log('  👋 Claude 사무실을 껐어요.');
  if (rt) runtime.remove(rt.pid); // 이미 꺼진 서버가 남긴 파일
  console.log('  켜져 있는 Claude 사무실이 없어요.');
}

// 플러그인 없이 hooks만 쓰고 싶을 때: 이 폴더의 hooks/notify.js를 가리키는 설정을 출력한다
function printHooks() {
  console.error(`  아래 "hooks" 내용을 ${SETTINGS_SHOWN} 에 합쳐 넣으세요. (이 폴더를 옮기면 다시 출력해야 해요)`);
  console.error('  알아서 넣어 주길 바라면 --install-hooks를 쓰세요.\n');
  console.log(JSON.stringify({ hooks: ourHooks(__dirname) }, null, 2));
}

// 오늘의 업무 일지를 터미널에 (브라우저의 📓과 같은 내용)
// --journal 뒤에 어제·그저께·-3·3일 전·금요일·지난 주 금요일·10월 31일·2026-10-31을 붙이면 그날 일지 (lib/report.js parseDay)
// '10월 31일'처럼 띄어 쓴 날도 받으려고, 다음 --옵션 전까지를 이어 붙인다
const journalDay = () => argWords('--journal') || '';

async function printJournal() {
  const v = journalDay();
  const project = argWords('--project') || ''; // --project blog: 그 프로젝트만 (--project my app처럼 빈칸이 든 이름도)
  // 이번 주·지난 주: 그 주의 날마다 일지를 모아 주간 일지로
  const week = parseWeek(v);
  if (week) {
    const days = await weekDays(week, project);
    console.log(args.includes('--md') ? weekMarkdown(days) : weekText(days));
    return;
  }
  // 이번 달·지난 달·10월: 그 달을 주마다·프로젝트마다
  const month = parseMonth(v);
  if (month) {
    const days = await weekDays(month, project);
    console.log(args.includes('--md') ? monthMarkdown(days, month.month) : monthText(days, month.month));
    return;
  }
  // 앞날·너무 먼 옛날은 빈 일지('이날은 일한 기록이 없어요') 대신 그렇다고 알려 준다
  const problem = dayProblem(v);
  if (problem) {
    const hint = /안 온/.test(problem) ? '업무 일지는 오늘까지만 있어요. 지난 날은 어제·지난 금요일·10월 31일처럼 적어 주세요.' : '10년 안의 날로 적어 주세요.';
    console.log(`\n  ⚠ ${problem}: ${v}\n    ${hint}\n`);
    process.exitCode = 1;
    return;
  }
  const day = parseDay(v);
  if (day === null) {
    console.log(`\n  ⚠ 어느 날인지 모르겠어요: ${v}\n    오늘·어제·그저께, -3이나 3일 전, 금요일·지난 금요일·지난 주 금요일, 10/31이나 10월 31일, 2026-10-31, 한 주는 이번 주·지난 주·2주 전, 한 달은 이번 달·지난 달·10월처럼 적어 주세요.\n`);
    process.exitCode = 1;
    return;
  }
  const j = await journal(day, project);
  console.log(args.includes('--md') ? journalMarkdown(j) : journalText(j));
}

if (require.main === module) {
  const problem = argProblem();
  if (problem) {
    console.log(`\n  ⚠ ${problem}\n    쓸 수 있는 옵션은 ${runCmd('--help')} 로 볼 수 있어요.\n`);
    process.exit(1);
  }
  // 사무실을 켤 때(그냥 실행·--background)만 쓰는 환경 변수가 잘못됐으면 켜기 전에 알려 준다
  const starting = !['--journal', '--print-hooks', '--install-hooks', '--uninstall-hooks', '--stop'].some(o => args.includes(o));
  const envBad = starting && envProblem();
  if (envBad) {
    console.log(`\n  ⚠ ${envBad}\n    환경 변수를 고치거나 지운 뒤 다시 실행해 주세요.\n`);
    process.exit(1);
  }
  if (args.includes('--journal')) printJournal();
  else if (args.includes('--print-hooks')) printHooks();
  else if (args.includes('--install-hooks')) {
    const r = installHooks(CLAUDE_DIR, __dirname);
    console.log(`\n${r.text}\n`);
    if (!r.ok) process.exitCode = 1;
  } else if (args.includes('--uninstall-hooks')) {
    const r = uninstallHooks(CLAUDE_DIR, __dirname);
    console.log(`\n${r.text}\n`);
    if (!r.ok) process.exitCode = 1;
  } else if (args.includes('--stop')) stopServer();
  else if (args.includes('--background')) startBackground();
  else serve();
}

// 테스트가 쓰는 것들 (기록 해석은 lib/normalize.js, 세션 따라 읽기는 lib/sessions.js에 있다)
module.exports = { ...normalize, scanSessions, describe };
