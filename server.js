#!/usr/bin/env node
// Claude 사무실 — Claude Code 세션 기록(~/.claude/projects/**/*.jsonl)을 0.25초마다 따라 읽어서
// 브라우저(SSE)로 정규화된 활동 이벤트를 보내는 작은 서버. 의존성 없음 (Node 18+).
//
//   node server.js               → http://localhost:4777 (브라우저 자동으로 열림)
//   node server.js --port 5000   → 다른 포트
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
    --background    터미널 창 없이 뒤에서 켜기 (이미 켜져 있으면 화면만 열기)
    --stop          뒤에서 켜 둔 사무실 끄기
    --print-hooks   권한 확인 대기를 알려 줄 Claude Code hooks 설정 출력
    -h, --help      이 도움말
`);
  process.exit(0);
}

const VERSION = require('./package.json').version;
const PORT = Number(argValue('--port')) || Number(process.env.PORT) || 4777;
const OPEN_BROWSER = !args.includes('--no-open') && !process.env.NO_OPEN;
const POLL_MS = 250;
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const PROJECTS = path.join(CLAUDE_DIR, 'projects');
const PUBLIC = path.join(__dirname, 'public');
const HISTORY_EVENTS = 300;
const MAX_INITIAL_BYTES = 40 * 1024 * 1024; // 세션 하나만 볼 때 처음에 읽는 양
const ALL_INITIAL_BYTES = 8 * 1024 * 1024; // 빌딩(여러 세션)에서 세션마다 처음에 읽는 양
const SUB_INITIAL_BYTES = 4 * 1024 * 1024; // 서브에이전트 기록
const ACTIVE_MS = 30 * 60 * 1000; // 빌딩에 들어오는 세션: 최근 30분 안에 움직인 세션
const SUB_IDLE_MS = 10 * 60 * 1000; // 이만큼 조용한 서브에이전트는 처음 화면에 띄우지 않는다
const MAX_SESSIONS = 12;
const MAX_HOOK_BYTES = 1024 * 1024;
// hook 요청은 실행 정보 파일(lib/runtime.js)을 읽을 수 있는 쪽, 즉 이 컴퓨터의 나만 보낼 수 있다
const TOKEN = crypto.randomBytes(16).toString('hex');

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
  ListAgents: 'meeting', RemoteTrigger: 'meeting',
  AskUserQuestion: 'desk', SendUserFile: 'desk', PushNotification: 'desk', ReportFindings: 'desk',
  Artifact: 'desk', ArtifactComments: 'desk', ArtifactData: 'desk',
};

// MCP 도구는 대부분 바깥 서비스라 정보 검색실로 가지만, 성격이 분명한 서버는 따로 보낸다
const ROOM_BY_MCP = [
  [/^mcp__ccd_turn__update_plan$/, 'meeting'],
  [/^mcp__ccd_turn__wrap_up$/, 'desk'],
  [/^mcp__ccd_(session|session_mgmt|sidebar|window)__/, 'meeting'], // 세션·작업 관리
  [/^mcp__ccd_(view|settings)__/, 'desk'], // 사용자에게 화면을 보여 주거나 설정을 묻는 일
  [/^mcp__(terminal|ccd_host|ccd_pr)__/, 'server'], // 터미널, PR·브랜치 상태
  [/^mcp__Claude_Code_iOS_Simulator__/, 'server'], // 앱을 빌드하고 띄우는 일
];

// 처음 보는 도구는 이름을 보고 어울리는 방을 고른다 (위에서부터 먼저 맞는 것)
const ROOM_BY_WORD = [
  [/bash|shell|exec|run|kill|terminal|process|build|deploy/i, 'server'],
  [/web|http|url|browser|fetch/i, 'search'],
  [/plan|task|todo|agent|schedule|cron|message|team|trigger/i, 'meeting'],
  [/ask|notify|notification|send|report|share|publish/i, 'desk'],
  [/read|get|list|search|find|glob|grep|view|query|lookup/i, 'library'],
];

function roomOf(name) {
  if (ROOM_BY_TOOL[name]) return ROOM_BY_TOOL[name];
  if (name.startsWith('mcp__')) {
    const hit = ROOM_BY_MCP.find(([re]) => re.test(name));
    return hit ? hit[1] : 'search';
  }
  const hit = ROOM_BY_WORD.find(([re]) => re.test(name));
  return hit ? hit[1] : 'dev';
}

// 이미 '질문하러 오기'로 보여 주는 도구라 권한 대기로 따로 연출하지 않는다
const ASK_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);

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
  // sidechain: 서브에이전트 기록처럼 isSidechain 줄을 버리지 않고 읽을 때
  constructor({ sidechain = false } = {}) {
    this.sidechain = sidechain;
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
    if (j.isSidechain && !this.sidechain) return [];
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
    const label = labelOf(name, input);
    this.tools.set(b.id, { name, room, label, done: false });
    this.stats[room]++;
    this.stats.tools++;
    const ev = {
      k: 'tool', ts, id: b.id, name, tool: displayName(name), room,
      label, detail: detailOf(name, input),
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

  // 아직 결과가 오지 않은 도구 중 가장 최근 것의 id. 이름이 주어지면 그 이름만, 라벨까지 같으면 그쪽을 고른다.
  openTool(names, label) {
    let hit = null, loose = null;
    for (const [id, t] of this.tools) {
      if (t.done || ASK_TOOLS.has(t.name) || (names.length && !names.includes(t.name))) continue;
      loose = id;
      if (label && t.label === label) hit = id;
    }
    return hit || loose;
  }

  result(b, ts) {
    const t = this.tools.get(b.tool_use_id) || {};
    t.done = true;
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

// ───────────────────────── 권한 확인 대기 (hooks) ─────────────────────────
// 권한 확인 창이 떠 있다는 사실은 세션 기록에 남지 않아서, Claude Code hook(hooks/notify.js)이 알려 준 것을 따로 들고 있다.
// 세션 id → { kind: 'permission'|'input', ts, match, agentId, name, tool, room, label, detail, text, id, on }
//   id: 기다리는 도구의 tool_use id · on: 대기를 보여 줄 캐릭터 ('' = 메인, 아니면 서브에이전트 id)
const waits = new Map();
const followers = new Set();
const ENDS_WAIT = new Set(['user', 'turn_end', 'interrupt', 'compact']);
const waitKey = w => (w ? `${w.ts}|${w.id || ''}|${w.on || ''}` : '');
const isFinal = e => e.k === 'say' && e.final;

function onHook(h) {
  const sid = String(h.session_id || '');
  if (!sid) return;
  const agentId = h.agent_id ? String(h.agent_id) : '';
  let w = null;
  switch (h.hook_event_name) {
    case 'PermissionRequest': {
      const name = String(h.tool_name || '');
      if (!name || ASK_TOOLS.has(name)) return;
      const input = h.tool_input || {};
      w = {
        kind: 'permission', ts: Date.now(), match: [name], agentId, agent: !!agentId,
        name, tool: displayName(name), room: roomOf(name), label: labelOf(name, input), detail: detailOf(name, input),
      };
      break;
    }
    case 'Notification': {
      // 권한 확인 창이 6초쯤 그대로면 오는 알림. PermissionRequest를 못 받았을 때만 쓴다.
      const t = h.notification_type;
      if (waits.has(sid) || (t !== 'permission_prompt' && t !== 'elicitation_dialog')) return;
      w = { kind: t === 'permission_prompt' ? 'permission' : 'input', ts: Date.now(), match: [], agentId, agent: !!agentId, text: clip(h.message, 120) };
      break;
    }
    case 'SessionEnd':
      if (!waits.delete(sid)) return;
      break;
    default:
      return;
  }
  if (w) waits.set(sid, w);
  let file = null;
  if (w) for (const f of followers) if (f.mode !== 'file' && !f.sessions.has(sid)) { file = findSession(sid); break; }
  for (const f of followers) f.hook(sid, file);
}

function findSession(sid) {
  const s = scanSessions().find(x => path.basename(x.file, '.jsonl') === sid);
  return s ? s.file : null;
}

// 빌딩에 보일 세션: 최근 30분 안에 움직였거나 권한을 기다리는 세션 (하나도 없으면 가장 최근 하나)
function activeFiles() {
  const all = scanSessions();
  const pick = all.filter(s => Date.now() - s.mtime < ACTIVE_MS || waits.has(path.basename(s.file, '.jsonl'))).slice(0, MAX_SESSIONS);
  return (pick.length ? pick : all.slice(0, 1)).map(s => s.file);
}

// ───────────────────────── 기록 파일 따라 읽기 ─────────────────────────
// 파일 하나(메인 세션 또는 서브에이전트)를 끝까지 읽어 두고, 그 뒤로 붙는 줄만 이벤트로 바꾼다.
class Tail {
  constructor(file, opts) {
    this.file = file;
    this.norm = new Normalizer(opts);
    this.offset = 0;
    this.rest = Buffer.alloc(0);
    this.mtime = 0;
    this.size = 0;
    this.lastGrow = 0;
  }

  // 처음 붙을 때: 끝에서 maxBytes까지 읽어 지난 이벤트를 만든다. 파일이 없으면 null.
  load(maxBytes) {
    let st;
    try { st = fs.statSync(this.file); } catch { return null; }
    const start = Math.max(0, st.size - maxBytes);
    const buf = readRange(this.file, start, st.size);
    const nl = buf.lastIndexOf(0x0a);
    this.rest = Buffer.from(buf.subarray(nl + 1));
    this.offset = start + buf.length;
    this.mtime = this.lastGrow = st.mtimeMs;
    this.size = st.size;
    const lines = nl >= 0 ? buf.subarray(0, nl).toString('utf8').split('\n') : [];
    if (start > 0) lines.shift();
    return this.parse(lines);
  }

  // 지난번 이후 새로 붙은 줄. 파일이 줄어들었으면(다시 쓰임) null.
  more() {
    let st;
    try { st = fs.statSync(this.file); } catch { return []; }
    if (st.size < this.offset) return null;
    if (st.size === this.offset) return [];
    const buf = readRange(this.file, this.offset, st.size);
    this.offset += buf.length;
    this.size = st.size;
    this.mtime = st.mtimeMs;
    this.lastGrow = Date.now();
    const data = this.rest.length ? Buffer.concat([this.rest, buf]) : buf;
    const nl = data.lastIndexOf(0x0a);
    if (nl < 0) { this.rest = Buffer.from(data); return []; }
    this.rest = Buffer.from(data.subarray(nl + 1));
    return this.parse(data.subarray(0, nl).toString('utf8').split('\n'));
  }

  parse(lines) {
    const out = [];
    for (const l of lines) for (const e of this.norm.line(l)) out.push(e);
    return out;
  }
}

// 세션 하나 = 메인 기록 + 서브에이전트 기록들(<세션id>/subagents/agent-*.jsonl)
class Session {
  constructor(file, maxBytes) {
    this.file = file;
    this.sid = path.basename(file, '.jsonl');
    this.subDir = path.join(path.dirname(file), this.sid, 'subagents');
    this.maxBytes = maxBytes;
    this.main = new Tail(file);
    this.subs = new Map(); // 서브에이전트 id → { tail, info }
    this.waitKey = '';
  }

  // 화면에 처음 보낼 모습. 파일을 못 읽으면 null.
  snapshot() {
    const events = this.main.load(this.maxBytes);
    if (!events) return null;
    const agents = [];
    const subEvents = new Map();
    for (const { a, evs } of this.findAgents()) {
      subEvents.set(a.info.id, evs);
      // 끝났거나 오래 조용한 서브에이전트는 빼고, 지금 일하는 인턴만 보낸다
      const last = evs[evs.length - 1];
      if (!last || isFinal(last) || Date.now() - a.tail.mtime > SUB_IDLE_MS) continue;
      agents.push({ ...a.info, history: evs.slice(-40).map(e => ({ ...e, agent: a.info.id })) });
    }
    const wait = this.checkWait(events, subEvents);
    this.waitKey = waitKey(wait);
    const st = { file: this.file, mtime: this.main.mtime, size: this.main.size, dir: baseName(path.dirname(this.file)) };
    return {
      sid: this.sid,
      session: { ...describe(st), ...this.metaOut() },
      history: events.slice(-HISTORY_EVENTS),
      plan: this.main.norm.plan,
      stats: this.stats(),
      wait,
      agents,
    };
  }

  // 새로 생긴 서브에이전트 기록 파일을 등록하고 읽어 둔다 (meta.json에 종류·설명·부모 도구 id가 있다)
  findAgents() {
    const found = [];
    let names;
    try { names = fs.readdirSync(this.subDir); } catch { return found; }
    for (const f of names) {
      const m = f.match(/^agent-(.+)\.jsonl$/);
      if (!m || this.subs.has(m[1])) continue;
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(this.subDir, `agent-${m[1]}.meta.json`), 'utf8')); } catch { /* 메타 없음 */ }
      const a = {
        tail: new Tail(path.join(this.subDir, f), { sidechain: true }),
        info: { id: m[1], type: clip(meta.agentType, 30), desc: clip(meta.description, 60), parent: String(meta.toolUseId || '') },
      };
      this.subs.set(m[1], a);
      found.push({ a, evs: a.tail.load(SUB_INITIAL_BYTES) || [] });
    }
    return found;
  }

  // 새 줄을 읽어 화면에 보낼 변화. 변화가 없으면 null, 파일이 다시 쓰였으면 'reset'.
  poll(tick, force) {
    const main = this.main.more();
    if (!main) return 'reset';
    const events = main.slice();
    const subEvents = new Map();
    if (force || tick % 8 === 0) {
      for (const { a, evs } of this.findAgents()) {
        subEvents.set(a.info.id, evs);
        // 새 인턴: 소개 이벤트 다음에 지금까지 한 일을 붙인다
        events.push({ k: 'agent', ts: Date.now(), agent: a.info.id, type: a.info.type, desc: a.info.desc, parent: a.info.parent });
        for (const e of evs.slice(-40)) events.push({ ...e, agent: a.info.id });
      }
    }
    for (const [id, a] of this.subs) {
      const evs = a.tail.more();
      if (evs === null) { a.tail.load(SUB_INITIAL_BYTES); continue; }
      if (!evs.length) continue;
      subEvents.set(id, (subEvents.get(id) || []).concat(evs));
      for (const e of evs) events.push({ ...e, agent: id });
    }
    const wait = this.checkWait(main, subEvents);
    const key = waitKey(wait);
    if (!events.length && !force && key === this.waitKey) return null;
    this.waitKey = key;
    return { sid: this.sid, events, plan: this.main.norm.plan, stats: this.stats(), meta: this.metaOut(), wait };
  }

  // 이 세션의 권한 대기. 기다리는 도구를 기록에서 찾아 id를 붙이고, 이미 끝난 대기는 지운다.
  checkWait(mainEvents, subEvents) {
    const w = waits.get(this.sid);
    if (!w) return null;
    if (!w.id) {
      const sub = w.agentId && this.subs.get(w.agentId);
      if (sub) {
        w.id = sub.tail.norm.openTool(w.match, w.label);
        w.on = w.agentId;
      } else {
        // 서브에이전트 기록을 아직 못 찾았으면 메인 세션에서 실행 중인 Agent 도구에 붙인다
        w.id = this.main.norm.openTool(w.agentId ? ['Agent', 'Task'] : w.match, w.agentId ? '' : w.label);
        w.on = '';
      }
    }
    // 다른 화면이 먼저 찾은 서브에이전트일 수 있으니, 없으면 한 번 더 찾아본다
    const sub = w.on && (this.subs.get(w.on) || (this.findAgents(), this.subs.get(w.on)));
    const norm = sub ? sub.tail.norm : this.main.norm;
    const events = w.on ? subEvents.get(w.on) || [] : mainEvents;
    const t = w.id && norm.tools.get(w.id);
    const moved = events.some(e => e.ts >= w.ts && (ENDS_WAIT.has(e.k) || isFinal(e)));
    // 기다린다는 도구가 3초가 지나도 기록에 없으면 이미 끝난 대기로 본다
    if ((t && t.done) || moved || (!w.id && Date.now() - w.ts > 3000)) {
      waits.delete(this.sid);
      return null;
    }
    return w;
  }

  // 방별 사용량은 서브에이전트가 쓴 도구까지 합친다
  stats() {
    const s = { ...this.main.norm.stats };
    for (const a of this.subs.values()) {
      for (const k of ['library', 'dev', 'server', 'search', 'meeting', 'desk', 'tools', 'errors']) s[k] += a.tail.norm.stats[k];
    }
    return s;
  }

  metaOut() {
    const m = this.main.norm.meta;
    const out = { model: m.model, branch: m.branch };
    if (m.title) out.title = clip(m.title, 70);
    if (m.cwd) { out.cwd = m.cwd; out.project = baseName(m.cwd); }
    return out;
  }
}

// ───────────────────────── 화면(SSE 연결)마다 ─────────────────────────
// mode: 'all' 최근에 움직인 세션 전부(빌딩) · 'auto' 가장 최근 세션 하나 · 'file' 고른 세션 하나
class Follower {
  constructor(res, want) {
    this.res = res;
    this.mode = want === 'all' || want === 'auto' ? want : 'file';
    this.pinned = this.mode === 'file' ? want : null;
    this.sessions = new Map();
    this.tick = 0;
    this.lastWrite = Date.now();
    followers.add(this);
    const first = this.mode === 'all' ? activeFiles() : [this.pinned || (scanSessions()[0] || {}).file].filter(Boolean);
    this.hello(first);
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  send(event, data) {
    this.lastWrite = Date.now();
    this.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  // 보여 줄 세션을 새로 정하고 처음부터 다시 그리게 한다
  hello(files) {
    this.sessions.clear();
    const snaps = files.map(f => this.open(f)).filter(Boolean);
    this.send('hello', { mode: this.mode, root: PROJECTS, sessions: snaps });
  }

  open(file) {
    const s = new Session(file, this.mode === 'all' ? ALL_INITIAL_BYTES : MAX_INITIAL_BYTES);
    const snap = s.snapshot();
    if (!snap) return null;
    this.sessions.set(s.sid, s);
    return snap;
  }

  // 빌딩에 세션 하나를 더한다 (이미 있으면 다시 읽어 바꾼다)
  join(file) {
    const snap = this.open(file);
    if (snap) this.send('join', snap);
    // 너무 많으면 가장 오래 조용한 세션부터 뺀다 (권한을 기다리는 세션은 남긴다)
    const quiet = [...this.sessions.values()].filter(s => !waits.has(s.sid)).sort((a, b) => a.main.lastGrow - b.main.lastGrow);
    while (this.sessions.size > MAX_SESSIONS && quiet.length) {
      const s = quiet.shift();
      this.sessions.delete(s.sid);
      this.send('leave', { sid: s.sid });
    }
  }

  poll() {
    this.tick++;
    try {
      if (this.tick % 8 === 0) this.discover();
      const updates = [];
      for (const s of [...this.sessions.values()]) {
        const u = s.poll(this.tick, false);
        if (u === 'reset') this.join(s.file);
        else if (u) updates.push(u);
      }
      if (updates.length) this.send('events', { updates });
      if (Date.now() - this.lastWrite > 15000) { this.res.write(': ping\n\n'); this.lastWrite = Date.now(); }
    } catch (e) {
      console.error('[poll]', e.message);
    }
  }

  discover() {
    if (this.mode === 'all') {
      for (const f of activeFiles()) if (!this.sessions.has(path.basename(f, '.jsonl'))) this.join(f);
    } else if (this.mode === 'auto') {
      const cur = [...this.sessions.values()][0];
      if (cur && waits.has(cur.sid)) return; // 내 답을 기다리는 세션에서는 떠나지 않는다
      const newest = scanSessions()[0];
      if (!newest || (cur && newest.file === cur.file)) return;
      // 다른 세션이 방금 기록됐고, 지금 세션은 4초 이상 조용하면 갈아탄다.
      if (!cur || (Date.now() - newest.mtime < 5000 && Date.now() - cur.main.lastGrow > 4000)) this.hello([newest.file]);
    }
  }

  // hook이 알려 온 일. 보고 있는 세션이면 바로 다시 읽고, 아니면 권한을 기다리는 세션을 데려온다.
  hook(sid, file) {
    const s = this.sessions.get(sid);
    if (s) {
      const u = s.poll(this.tick, true);
      if (u === 'reset') this.join(s.file);
      else if (u) this.send('events', { updates: [u] });
    } else if (file && this.mode === 'all') this.join(file);
    else if (file && this.mode === 'auto') this.hello([file]);
  }

  close() {
    clearInterval(this.timer);
    followers.delete(this);
  }
}

// ───────────────────────── HTTP ─────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function json(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function sameToken(t) {
  const a = Buffer.from(String(t || '')), b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// hook 알림과 끄기 요청. 실행 정보 파일의 토큰을 아는 쪽(같은 컴퓨터의 나)만 보낼 수 있다.
function handlePost(req, res, pathname) {
  if (!sameToken(req.headers['x-office-token'])) { res.writeHead(403); return res.end(); }
  if (pathname === '/api/shutdown') {
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
    try { onHook(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { console.error('[hook]', e.message); }
  });
}

const server = http.createServer((req, res) => {
  // DNS 리바인딩 막기: 다른 사이트 주소로 들어온 요청은 받지 않는다
  if (!LOCAL_HOST.test(req.headers.host || '')) { res.writeHead(403); return res.end('forbidden'); }
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
  if (req.method === 'POST') return handlePost(req, res, url.pathname);

  if (url.pathname === '/api/health') return json(res, { app: 'claude-office', version: VERSION, pid: process.pid });

  if (url.pathname === '/api/sessions') {
    const all = scanSessions();
    const top = all.slice(0, 30);
    // 화면에서 고정해 둔 세션은 오래돼서 30개 밖으로 밀려도 목록에 남긴다
    const keep = url.searchParams.get('keep');
    if (keep && insideProjects(keep)) {
      const k = all.find(x => x.file === path.resolve(keep));
      if (k && !top.includes(k)) top.push(k);
    }
    const list = top.map(s => ({ ...describe(s), waiting: waits.has(path.basename(s.file, '.jsonl')) }));
    return json(res, { root: PROJECTS, sessions: list });
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
  const file = path.join(PUBLIC, rel);
  const inside = path.relative(PUBLIC, file);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) { res.writeHead(403); return res.end(); }
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

// ───────────────────────── 실행 방법 ─────────────────────────
function serve() {
  const url = `http://localhost:${PORT}`;
  server.on('error', async e => {
    if (e.code === 'EADDRINUSE') {
      if (await runtime.health(PORT)) {
        console.log(`\n  🏢 Claude 사무실이 이미 켜져 있어요 → ${url}\n`);
        if (OPEN_BROWSER) openBrowser(url);
        process.exit(0);
      }
      console.log(`\n  ⚠ ${PORT}번 포트를 다른 프로그램이 쓰고 있어요.`);
      console.log(`    다른 포트로 실행하려면: claude-office --port 4778\n`);
    } else {
      console.error(e);
    }
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => {
    try {
      runtime.write({ pid: process.pid, port: PORT, token: TOKEN, version: VERSION });
    } catch (e) {
      console.log(`  ⚠ 실행 정보 파일을 쓰지 못해서 hooks 연동은 꺼져 있어요 (${e.message})`);
    }
    process.on('exit', () => runtime.remove(process.pid));
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));
    console.log(`\n  🏢 Claude 사무실이 열렸어요 → ${url}`);
    console.log(`  📂 세션 기록 폴더: ${PROJECTS}${fs.existsSync(PROJECTS) ? '' : '  (아직 없음 — claude를 한 번 실행하면 생겨요)'}`);
    console.log(`  ⏱  ${POLL_MS}ms마다 최신 세션을 따라 읽는 중… (끄려면 Ctrl+C)\n`);
    if (OPEN_BROWSER) openBrowser(url);
  });
}

// 터미널 창 없이 뒤에서 켠다. 이미 켜져 있으면 화면만 연다. (플러그인의 /office:open이 쓰는 방법)
async function startBackground() {
  const running = runtime.read();
  if (running && (await runtime.health(running.port))) {
    const url = `http://localhost:${running.port}`;
    console.log(`  🏢 Claude 사무실이 이미 켜져 있어요 → ${url}`);
    if (OPEN_BROWSER) openBrowser(url);
    return;
  }
  const childArgs = [__filename, ...args.filter(a => a !== '--background' && a !== '--no-open'), '--no-open'];
  const child = spawn(process.execPath, childArgs, { detached: true, stdio: 'ignore', windowsHide: true });
  let exited = false;
  child.on('exit', () => { exited = true; });
  child.unref();
  for (let i = 0; i < 40 && !exited; i++) {
    await new Promise(r => setTimeout(r, 150));
    const rt = runtime.read();
    if (rt && rt.pid === child.pid) {
      const url = `http://localhost:${rt.port}`;
      console.log(`  🏢 Claude 사무실을 뒤에서 켰어요 → ${url}`);
      console.log(`     끄려면: node "${__filename}" --stop`);
      if (OPEN_BROWSER) openBrowser(url);
      return;
    }
  }
  console.log(`  ⚠ 사무실을 켜지 못했어요. 터미널에서 node "${__filename}" 로 직접 실행해서 오류를 확인해 보세요.`);
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
  const text = fs.readFileSync(path.join(__dirname, 'hooks', 'hooks.json'), 'utf8')
    .split('${CLAUDE_PLUGIN_ROOT}').join(JSON.stringify(__dirname).slice(1, -1));
  console.error('  아래 "hooks" 내용을 ~/.claude/settings.json 에 합쳐 넣으세요. (이 폴더를 옮기면 다시 출력해야 해요)\n');
  console.log(JSON.stringify({ hooks: JSON.parse(text).hooks }, null, 2));
}

if (require.main === module) {
  if (args.includes('--print-hooks')) printHooks();
  else if (args.includes('--stop')) stopServer();
  else if (args.includes('--background')) startBackground();
  else serve();
}

module.exports = { Normalizer, scanSessions, describe, labelOf, roomOf, displayName, planFromMarkdown };
