#!/usr/bin/env node
// Claude 사무실 — Claude Code 세션 기록(~/.claude/projects/**/*.jsonl)을 0.25초마다 따라 읽어서
// 브라우저(SSE)로 정규화된 활동 이벤트를 보내는 작은 서버. 의존성 없음 (Node 18+).
//
//   node server.js               → http://localhost:4777 (브라우저 자동으로 열림)
//   node server.js --port 5000   → 다른 포트
//   node server.js --no-open     → 브라우저 자동 열기 끄기
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const argValue = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  Claude 사무실 — Claude Code가 지금 뭘 하는지 캐릭터로 보여 줍니다.

  사용법: claude-office [옵션]   (또는 node server.js [옵션])

    --port <번호>   사용할 포트 (기본 4777, 환경 변수 PORT로도 지정 가능)
    --no-open       브라우저를 자동으로 열지 않기
    -h, --help      이 도움말
`);
  process.exit(0);
}

const PORT = Number(argValue('--port')) || Number(process.env.PORT) || 4777;
const OPEN_BROWSER = !args.includes('--no-open') && !process.env.NO_OPEN;
const POLL_MS = 250;
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const PROJECTS = path.join(CLAUDE_DIR, 'projects');
const PUBLIC = path.join(__dirname, 'public');
const HISTORY_EVENTS = 300;
const MAX_INITIAL_BYTES = 40 * 1024 * 1024;

// ───────────────────────── 도구 → 방 매핑 ─────────────────────────
// library 자료실 · dev 개발실 · server 서버실 · search 정보 검색실 · meeting 회의실 · desk 내 자리
const ROOM_BY_TOOL = {
  Read: 'library', Glob: 'library', Grep: 'library', LS: 'library', NotebookRead: 'library',
  Skill: 'library', ToolSearch: 'library',
  Edit: 'dev', Write: 'dev', MultiEdit: 'dev', NotebookEdit: 'dev',
  Bash: 'server', PowerShell: 'server', BashOutput: 'server', KillBash: 'server', KillShell: 'server',
  TaskOutput: 'server', TaskStop: 'server', Monitor: 'server', EnterWorktree: 'server', ExitWorktree: 'server',
  WebSearch: 'search', WebFetch: 'search', ListMcpResourcesTool: 'search', ReadMcpResourceTool: 'search',
  TodoWrite: 'meeting', TodoRead: 'meeting', TaskCreate: 'meeting', TaskUpdate: 'meeting', TaskList: 'meeting',
  TaskGet: 'meeting', EnterPlanMode: 'meeting', ExitPlanMode: 'meeting', Agent: 'meeting', Task: 'meeting',
  SendMessage: 'meeting', CronCreate: 'meeting', CronDelete: 'meeting', CronList: 'meeting', ScheduleWakeup: 'meeting',
  AskUserQuestion: 'desk', SendUserFile: 'desk', PushNotification: 'desk',
};

function roomOf(name) {
  if (ROOM_BY_TOOL[name]) return ROOM_BY_TOOL[name];
  if (name.startsWith('mcp__')) {
    if (/^mcp__ccd_turn__(update_plan)$/.test(name)) return 'meeting';
    if (/^mcp__ccd_turn__wrap_up$/.test(name)) return 'desk';
    if (/^mcp__ccd_session__(mark_chapter|start_session|hand_off_to_session|dismiss_task)$/.test(name)) return 'meeting';
    if (/^mcp__(terminal|ccd_host)__/.test(name)) return 'server';
    return 'search';
  }
  return 'dev';
}

// ───────────────────────── 텍스트 다듬기 ─────────────────────────
const clip = (s, n) => {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const baseName = p => (p ? String(p).split(/[\\/]/).filter(Boolean).pop() || '' : '');
const firstLine = s => String(s || '').split(/\r?\n/).find(l => l.trim()) || '';
const host = u => { try { return new URL(u).hostname; } catch { return clip(u, 40); } };

function plainMarkdown(s) {
  return String(s || '')
    .replace(/```[\s\S]*?```/g, ' [코드] ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)[*_]([^*_]+)[*_]/g, '$1$2')
    .replace(/^\s*[-*+]\s+/gm, '· ')
    .replace(/^\s*>\s?/gm, '');
}

function thinkSummary(t) {
  t = String(t || '').trim();
  if (!t) return '';
  const bold = t.match(/^\*\*(.+?)\*\*/);
  if (bold) return clip(bold[1], 90);
  const sentence = t.split(/(?<=[.!?。])\s+|\n/).find(x => x.trim()) || t;
  return clip(plainMarkdown(sentence), 110);
}

function contentText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(b => (typeof b === 'string' ? b : b && b.type === 'text' ? b.text : '')).join('\n');
  return '';
}

function errorText(c) {
  let s = contentText(c).replace(/<\/?tool_use_error>/g, '').trim();
  if (/doesn't want to proceed|user (doesn't|did not) want|rejected/i.test(s)) return '사용자가 실행을 거절했어요';
  if (/interrupted by user/i.test(s)) return '사용자가 중단했어요';
  const lines = s.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (/^Exit code \d+/.test(lines[0] || '') && lines[1]) return clip(lines[0] + ' · ' + lines[1], 130);
  return clip(lines.slice(0, 2).join(' · ') || '도구 실행 실패', 130);
}

function userText(c) {
  let s;
  if (typeof c === 'string') s = c;
  else if (Array.isArray(c)) {
    const parts = [];
    for (const b of c) {
      if (!b) continue;
      if (b.type === 'text' && !/^\s*<system-reminder>/.test(b.text)) parts.push(b.text);
      if (b.type === 'image') parts.push('[이미지]');
      if (b.type === 'document') parts.push('[첨부 파일]');
    }
    s = parts.join('\n');
  } else return '';
  const cmd = s.match(/<command-name>([^<]*)<\/command-name>/);
  if (cmd) {
    const args = (s.match(/<command-args>([^<]*)<\/command-args>/) || [])[1] || '';
    return clip(cmd[1] + ' ' + args, 140);
  }
  if (/^\s*(<local-command-|<bash-|Caveat:)/.test(s)) return '';
  s = s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content>/g, ' [붙여넣은 내용] ');
  return clip(s, 160);
}

function isGitCommand(cmd) {
  return /(^|[\s;&|(])(git|gh)\s+[a-z-]+/.test(String(cmd || ''));
}

function displayName(name) {
  if (!name.startsWith('mcp__')) return name;
  const [, server = '', tool = ''] = name.split('__');
  let srv = server
    .replace(/^Claude_/, '')
    .replace(/^claude-in-chrome$/, 'Chrome')
    .replace(/^ccd_/, '');
  if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(srv)) srv = 'MCP';
  return `${srv}.${tool}`;
}

function labelOf(name, i = {}) {
  switch (name) {
    case 'Read': return baseName(i.file_path) + (i.offset ? ` (${i.offset}줄~)` : '');
    case 'Write': case 'Edit': case 'MultiEdit': return baseName(i.file_path);
    case 'NotebookEdit': case 'NotebookRead': return baseName(i.notebook_path);
    case 'Glob': return clip(i.pattern, 50);
    case 'Grep': return `"${clip(i.pattern, 36)}"` + (i.path ? ` · ${baseName(i.path)}` : '');
    case 'LS': return baseName(i.path);
    case 'Bash': case 'PowerShell': return clip(i.description || firstLine(i.command), 70);
    case 'BashOutput': case 'TaskOutput': return '백그라운드 출력 확인';
    case 'WebSearch': return clip(i.query, 60);
    case 'WebFetch': return host(i.url);
    case 'TodoWrite': return `할 일 ${(i.todos || []).length}개 정리`;
    case 'TaskCreate': return clip(i.subject || i.description, 60);
    case 'TaskUpdate': return `#${i.taskId} → ${i.status || '수정'}`;
    case 'Agent': case 'Task': return clip(i.description || i.prompt, 60);
    case 'AskUserQuestion': return clip((i.questions && i.questions[0] && i.questions[0].question) || i.question, 90);
    case 'Skill': return clip(i.skill, 50);
    case 'ToolSearch': return clip(i.query, 50);
    case 'ExitPlanMode': return '계획 승인 요청';
    case 'EnterPlanMode': return '계획 모드 시작';
    case 'SendUserFile': return (i.files || []).map(baseName).join(', ');
  }
  if (name === 'mcp__ccd_turn__update_plan') return Array.isArray(i.items) ? `계획 ${i.items.length}단계` : '진행 상황 갱신';
  if (name === 'mcp__ccd_turn__wrap_up') return clip(i.recap, 80);
  if (name.startsWith('mcp__')) {
    const hint = i.url || i.query || i.title || i.q || i.action || i.name || i.description || i.command || '';
    return clip(typeof hint === 'string' ? hint : '', 60);
  }
  return '';
}

function detailOf(name, i = {}) {
  if (name === 'Bash' || name === 'PowerShell') return clip(i.command, 160);
  if (i.file_path) return String(i.file_path);
  if (name === 'WebFetch') return clip(i.url, 160);
  return '';
}

function planFromMarkdown(md) {
  const lines = String(md || '').split(/\r?\n/);
  const title = (lines.find(l => /^#\s+/.test(l)) || '').replace(/^#\s+/, '').trim();
  const items = [];
  for (const l of lines) {
    const m = l.match(/^\s{0,3}(?:[-*+]|\d+[.)]|#{2,3})\s+(.+)/);
    if (m && items.length < 14) items.push({ text: clip(plainMarkdown(m[1]), 70), status: 'todo' });
  }
  return { title: clip(title || '계획', 40), items };
}

// ───────────────────────── jsonl → 이벤트 ─────────────────────────
// 이벤트 종류(k): user · think · say · tool(+plan/ask) · result · turn_end · interrupt · compact · apierr
class Normalizer {
  constructor() {
    this.tools = new Map();
    this.plan = null;
    this.taskSeq = 0;
    this.seen = new Set();
    this.stats = { library: 0, dev: 0, server: 0, search: 0, meeting: 0, desk: 0, tools: 0, errors: 0, prompts: 0 };
    this.meta = { title: '', cwd: '', model: '', branch: '' };
  }

  line(l) {
    if (!l || l.charCodeAt(0) !== 123) return [];
    let j;
    try { j = JSON.parse(l); } catch { return []; }
    if (j.type === 'custom-title' && j.customTitle) this.meta.title = j.customTitle;
    if (j.type === 'summary' && j.summary && !this.meta.title) this.meta.title = j.summary;
    if (j.cwd) this.meta.cwd = j.cwd;
    if (j.gitBranch) this.meta.branch = j.gitBranch;
    if (j.isSidechain) return [];
    if (j.uuid) {
      if (this.seen.has(j.uuid)) return [];
      this.seen.add(j.uuid);
    }
    const ts = Date.parse(j.timestamp) || Date.now();
    switch (j.type) {
      case 'assistant': return this.assistant(j, ts);
      case 'user': return this.user(j, ts);
      case 'system':
        if (j.subtype === 'compact_boundary') return [{ k: 'compact', ts }];
        if (j.subtype === 'stop_hook_summary' || j.subtype === 'turn_duration') return [{ k: 'turn_end', ts }];
        if (j.subtype === 'api_error' || j.level === 'error') return [{ k: 'apierr', ts, text: clip(j.content || 'API 오류', 120) }];
        return [];
      default: return [];
    }
  }

  assistant(j, ts) {
    const m = j.message || {};
    if (m.model && m.model !== '<synthetic>') this.meta.model = m.model;
    const blocks = Array.isArray(m.content) ? m.content : [];
    const out = [];
    for (const b of blocks) {
      if (!b) continue;
      if (b.type === 'thinking' || b.type === 'redacted_thinking') {
        out.push({ k: 'think', ts, text: thinkSummary(b.thinking), ms: j.thinkingDurationMs || 0 });
      } else if (b.type === 'text') {
        const text = clip(plainMarkdown(b.text), 220);
        if (!text) continue;
        if (m.model === '<synthetic>' || j.isApiErrorMessage) out.push({ k: 'apierr', ts, text });
        else out.push({ k: 'say', ts, text, final: m.stop_reason === 'end_turn' });
      } else if (b.type === 'tool_use' || b.type === 'server_tool_use') {
        out.push(...this.toolUse(b, ts));
      }
    }
    return out;
  }

  toolUse(b, ts) {
    const name = String(b.name || '?');
    const input = b.input || {};
    const room = name === 'web_search' || name === 'web_fetch' ? 'search' : roomOf(name);
    this.tools.set(b.id, { name, room });
    this.stats[room]++;
    this.stats.tools++;
    const ev = {
      k: 'tool', ts, id: b.id, name, tool: displayName(name), room,
      label: labelOf(name, input), detail: detailOf(name, input),
      git: (name === 'Bash' || name === 'PowerShell') && isGitCommand(input.command),
    };
    if (name === 'AskUserQuestion') {
      const q = (input.questions && input.questions[0]) || {};
      ev.ask = clip(q.question || input.question || '확인할 게 있어요', 120);
      ev.options = (q.options || []).slice(0, 4).map(o => clip(o.label || o, 24));
    }
    if (name === 'mcp__ccd_turn__wrap_up' && input.ask) ev.ask = clip(input.ask, 120);
    if (name === 'ExitPlanMode') ev.ask = '이 계획대로 진행해도 될까요?';
    const plan = this.updatePlan(name, input);
    if (plan) ev.plan = plan;
    return [ev];
  }

  setPlan(title, items) {
    this.plan = { title, items: items.filter(i => i.text) };
    return this.plan;
  }

  updatePlan(name, i) {
    const S = s => (s === 'completed' || s === 'done' ? 'done' : s === 'in_progress' ? 'doing' : 'todo');
    if (name === 'TodoWrite' && Array.isArray(i.todos)) {
      return this.setPlan('할 일', i.todos.map(t => ({ text: clip(t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content, 70), status: S(t.status) })));
    }
    if (name === 'mcp__ccd_turn__update_plan') {
      if (Array.isArray(i.items)) return this.setPlan('작업 계획', i.items.map(x => ({ text: clip(x.content, 70), status: S(x.status) })));
      if (!this.plan) return null;
      const items = this.plan.items.map(x => ({ ...x }));
      if (i.advance) {
        const cur = items.findIndex(x => x.status === 'doing');
        if (cur >= 0) items[cur].status = 'done';
        const next = items.findIndex(x => x.status === 'todo');
        if (next >= 0) items[next].status = 'doing';
      }
      for (const n of Array.isArray(i.done) ? i.done : []) if (items[n - 1]) items[n - 1].status = 'done';
      if (i.start && items[i.start - 1]) items[i.start - 1].status = 'doing';
      return this.setPlan(this.plan.title, items);
    }
    if (name === 'mcp__ccd_turn__wrap_up' && this.plan) {
      return this.setPlan(this.plan.title, this.plan.items.map(x => ({ ...x, status: 'done' })));
    }
    if (name === 'TaskCreate') {
      const items = this.plan && this.plan.title === '작업 목록' ? this.plan.items.slice() : [];
      items.push({ id: ++this.taskSeq, text: clip(i.subject || i.description, 70), status: 'todo' });
      return this.setPlan('작업 목록', items);
    }
    if (name === 'TaskUpdate' && this.plan) {
      let items = this.plan.items.map(x => ({ ...x }));
      const it = items.find(x => String(x.id) === String(i.taskId));
      if (it) {
        if (i.status === 'deleted') items = items.filter(x => x !== it);
        else if (i.status) it.status = S(i.status);
        if (i.subject) it.text = clip(i.subject, 70);
      }
      return this.setPlan(this.plan.title, items);
    }
    if (name === 'ExitPlanMode' && i.plan) {
      const p = planFromMarkdown(i.plan);
      return this.setPlan(p.title, p.items);
    }
    return null;
  }

  user(j, ts) {
    const c = j.message && j.message.content;
    if (j.isCompactSummary) return [{ k: 'compact', ts }];
    if (Array.isArray(c) && c.some(b => b && b.type === 'tool_result')) {
      return c.filter(b => b && b.type === 'tool_result').map(b => this.result(b, ts));
    }
    if (j.isMeta) return [];
    const text = userText(c);
    if (!text) return [];
    if (/^\[Request interrupted by user/.test(text)) return [{ k: 'interrupt', ts }];
    this.stats.prompts++;
    return [{ k: 'user', ts, text }];
  }

  result(b, ts) {
    const t = this.tools.get(b.tool_use_id) || {};
    const ok = !b.is_error;
    if (!ok) this.stats.errors++;
    const ev = { k: 'result', ts, id: b.tool_use_id, name: t.name, room: t.room, ok };
    if (!ok) ev.error = errorText(b.content);
    if (ok && t.name === 'AskUserQuestion') {
      const s = contentText(b.content);
      const answers = [...s.matchAll(/"[^"]*"\s*=\s*"([^"]*)"/g)].map(m => m[1]);
      ev.answer = clip(answers.join(', ') || s.replace(/^User has answered[^:]*:\s*/i, ''), 90);
    }
    return ev;
  }
}

// ───────────────────────── 세션 파일 목록 ─────────────────────────
function readRange(file, start, end) {
  const len = Math.max(0, end - start);
  const buf = Buffer.alloc(len);
  if (!len) return buf;
  const fd = fs.openSync(file, 'r');
  try {
    let got = 0;
    while (got < len) {
      const n = fs.readSync(fd, buf, got, len - got, start + got);
      if (!n) break;
      got += n;
    }
    return got === len ? buf : buf.subarray(0, got);
  } finally {
    fs.closeSync(fd);
  }
}

function scanSessions() {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { return out; }
  for (const d of dirs) {
    const dir = path.join(PROJECTS, d.name);
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const file = path.join(dir, f);
      try {
        const st = fs.statSync(file);
        out.push({ file, mtime: st.mtimeMs, size: st.size, dir: d.name });
      } catch { /* 지워진 파일 */ }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

const metaCache = new Map();
function describe(s) {
  const hit = metaCache.get(s.file);
  if (hit && hit.mtime === s.mtime) return hit;
  let title = '', prompt = '', cwd = '';
  const st = { size: s.size };
  const tail = readRange(s.file, Math.max(0, st.size - 256 * 1024), st.size).toString('utf8').split('\n');
  for (let i = tail.length - 1; i >= 0 && !(title && cwd); i--) {
    const l = tail[i];
    if (l.charCodeAt(0) !== 123) continue;
    let j;
    try { j = JSON.parse(l); } catch { continue; }
    if (!title && j.type === 'custom-title' && j.customTitle) title = j.customTitle;
    if (!title && j.type === 'summary' && j.summary) title = j.summary;
    if (!prompt && j.type === 'last-prompt' && j.lastPrompt) prompt = j.lastPrompt;
    if (!cwd && j.cwd) cwd = j.cwd;
  }
  const d = {
    file: s.file,
    id: path.basename(s.file, '.jsonl'),
    mtime: s.mtime,
    size: s.size,
    title: clip(title || prompt || '(제목 없음)', 70),
    project: cwd ? baseName(cwd) : s.dir,
    cwd,
  };
  metaCache.set(s.file, d);
  return d;
}

function insideProjects(file) {
  const rel = path.relative(PROJECTS, path.resolve(file));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) && rel.endsWith('.jsonl');
}

// ───────────────────────── 클라이언트별 추적기 ─────────────────────────
class Follower {
  constructor(res, requested) {
    this.res = res;
    this.auto = requested === 'auto';
    this.file = null;
    this.offset = 0;
    this.rest = Buffer.alloc(0);
    this.tick = 0;
    this.lastGrow = 0;
    this.lastWrite = Date.now();
    this.attach(this.auto ? (scanSessions()[0] || {}).file : requested);
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  send(event, data) {
    this.lastWrite = Date.now();
    this.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  attach(file) {
    this.file = file || null;
    this.rest = Buffer.alloc(0);
    this.offset = 0;
    this.norm = new Normalizer();
    if (!this.file) {
      this.send('hello', { auto: this.auto, session: null, history: [], plan: null, stats: this.norm.stats, root: PROJECTS });
      return;
    }
    let st;
    try { st = fs.statSync(this.file); } catch {
      this.send('hello', { auto: this.auto, session: null, history: [], plan: null, stats: this.norm.stats, root: PROJECTS, error: '파일을 열 수 없어요' });
      this.file = null;
      return;
    }
    const start = Math.max(0, st.size - MAX_INITIAL_BYTES);
    const buf = readRange(this.file, start, st.size);
    const nl = buf.lastIndexOf(0x0a);
    this.rest = Buffer.from(buf.subarray(nl + 1));
    this.offset = start + buf.length;
    const lines = nl >= 0 ? buf.subarray(0, nl).toString('utf8').split('\n') : [];
    if (start > 0) lines.shift();
    const events = [];
    for (const l of lines) for (const e of this.norm.line(l)) events.push(e);
    this.lastGrow = st.mtimeMs;
    this.send('hello', {
      auto: this.auto,
      session: { ...describe({ file: this.file, mtime: st.mtimeMs, size: st.size, dir: baseName(path.dirname(this.file)) }), ...this.metaOut() },
      history: events.slice(-HISTORY_EVENTS),
      plan: this.norm.plan,
      stats: this.norm.stats,
      root: PROJECTS,
    });
  }

  metaOut() {
    const m = this.norm.meta;
    const out = { model: m.model, branch: m.branch };
    if (m.title) out.title = clip(m.title, 70);
    if (m.cwd) { out.cwd = m.cwd; out.project = baseName(m.cwd); }
    return out;
  }

  maybeSwitch() {
    const newest = scanSessions()[0];
    if (!newest || newest.file === this.file) return;
    const idleMs = Date.now() - this.lastGrow;
    // 다른 세션이 방금 기록됐고, 지금 세션은 4초 이상 조용하면 갈아탄다.
    if (!this.file || (Date.now() - newest.mtime < 5000 && idleMs > 4000)) this.attach(newest.file);
  }

  poll() {
    this.tick++;
    try {
      if (this.auto && this.tick % 8 === 0) this.maybeSwitch();
      if (this.file) this.readNew();
      if (Date.now() - this.lastWrite > 15000) { this.res.write(': ping\n\n'); this.lastWrite = Date.now(); }
    } catch (e) {
      console.error('[poll]', e.message);
    }
  }

  readNew() {
    let st;
    try { st = fs.statSync(this.file); } catch { return; }
    if (st.size < this.offset) return this.attach(this.file); // 파일이 다시 쓰였음
    if (st.size === this.offset) return;
    const buf = readRange(this.file, this.offset, st.size);
    this.offset += buf.length;
    this.lastGrow = Date.now();
    const data = this.rest.length ? Buffer.concat([this.rest, buf]) : buf;
    const nl = data.lastIndexOf(0x0a);
    if (nl < 0) { this.rest = Buffer.from(data); return; }
    this.rest = Buffer.from(data.subarray(nl + 1));
    const events = [];
    for (const l of data.subarray(0, nl).toString('utf8').split('\n')) for (const e of this.norm.line(l)) events.push(e);
    if (events.length) this.send('events', { events, plan: this.norm.plan, stats: this.norm.stats, meta: this.metaOut() });
  }

  close() {
    clearInterval(this.timer);
  }
}

// ───────────────────────── HTTP ─────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/sessions') {
    const list = scanSessions().slice(0, 30).map(describe);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ root: PROJECTS, sessions: list }));
  }

  if (url.pathname === '/api/stream') {
    const want = url.searchParams.get('file') || 'auto';
    if (want !== 'auto' && !insideProjects(want)) {
      res.writeHead(400);
      return res.end('bad file');
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 1500\n\n');
    const f = new Follower(res, want);
    req.on('close', () => f.close());
    return;
  }

  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  });
});

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const cmdArgs = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true, windowsVerbatimArguments: true }).on('error', () => {}).unref();
  } catch { /* 브라우저를 못 열어도 주소는 콘솔에 나와 있다 */ }
}

if (require.main === module) {
  const url = `http://localhost:${PORT}`;
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.log(`\n  ⚠ ${PORT}번 포트를 이미 쓰고 있어요. Claude 사무실이 이미 켜져 있다면 ${url} 을 열어 보세요.`);
      console.log(`    다른 포트로 실행하려면: claude-office --port 4778\n`);
    } else {
      console.error(e);
    }
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`\n  🏢 Claude 사무실이 열렸어요 → ${url}`);
    console.log(`  📂 세션 기록 폴더: ${PROJECTS}${fs.existsSync(PROJECTS) ? '' : '  (아직 없음 — claude를 한 번 실행하면 생겨요)'}`);
    console.log(`  ⏱  ${POLL_MS}ms마다 최신 세션을 따라 읽는 중… (끄려면 Ctrl+C)\n`);
    if (OPEN_BROWSER) openBrowser(url);
  });
}

module.exports = { Normalizer, scanSessions, describe };
