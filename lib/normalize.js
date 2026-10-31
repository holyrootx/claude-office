// 세션 기록(jsonl) 한 줄을 화면용 이벤트로 바꾸는 부분: 도구 → 방 규칙, 표지판 글자, Normalizer.
'use strict';

const fs = require('fs');
const path = require('path');
const { CLAUDE_DIR } = require('./config');

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

// 내 방 설정: ~/.claude/claude-office.json 의 "rooms"에 { "도구 이름 패턴": "방" }을 적으면 그 규칙이 먼저 쓰인다.
// 패턴의 *는 아무 글자나 (예: "mcp__github__*"), 방은 영어 이름(server)이나 한국어 이름(서버실) 둘 다 된다.
// 파일을 고치면 서버를 다시 켜지 않아도 2초 안에 다시 읽는다.
const ROOM_CONFIG = path.join(CLAUDE_DIR, 'claude-office.json');
const ROOM_IDS = ['library', 'dev', 'server', 'search', 'meeting', 'desk'];
const ROOM_NAMES = { 자료실: 'library', 개발실: 'dev', 서버실: 'server', '정보 검색실': 'search', 검색실: 'search', 회의실: 'meeting', '내 자리': 'desk' };
const globRe = p => new RegExp('^' + String(p).split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
const roomRules = {
  list: [],
  mtime: -1,
  checkedAt: 0,
  get(force) {
    if (!force && Date.now() - this.checkedAt < 2000) return this.list;
    this.checkedAt = Date.now();
    let st;
    try { st = fs.statSync(ROOM_CONFIG); } catch { this.mtime = -1; return (this.list = []); }
    if (st.mtimeMs === this.mtime) return this.list;
    this.mtime = st.mtimeMs;
    try {
      const rooms = JSON.parse(fs.readFileSync(ROOM_CONFIG, 'utf8')).rooms || {};
      this.list = Object.entries(rooms).map(([pat, room]) => [globRe(pat), ROOM_NAMES[room] || room, pat]);
      const bad = this.list.filter(([, room]) => !ROOM_IDS.includes(room)).map(([, , pat]) => pat);
      if (bad.length) console.error(`  ⚠ 방 설정: 모르는 방이라 건너뛰어요 → ${bad.join(', ')}`);
      this.list = this.list.filter(([, room]) => ROOM_IDS.includes(room));
    } catch (e) {
      console.error(`  ⚠ 방 설정 파일(${ROOM_CONFIG})을 읽지 못했어요: ${e.message}`);
      this.list = [];
    }
    return this.list;
  },
};

function roomOf(name) {
  const mine = roomRules.get().find(([re]) => re.test(name));
  if (mine) return mine[1];
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

// 컨텍스트 창 크기 추정: Claude 5 이후 모델이나 [1m] 모델, 또는 이미 20만 토큰을 넘었으면 100만
function contextWindow(model, tokens) {
  const m = String(model || '').match(/claude-(?:opus|sonnet|haiku|fable)-(\d+)/);
  return tokens > 200000 || /\[1m\]/i.test(model || '') || (m && Number(m[1]) >= 5) ? 1000000 : 200000;
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
  // sidechain: 서브에이전트 기록처럼 isSidechain 줄을 버리지 않고 읽을 때
  constructor({ sidechain = false } = {}) {
    this.sidechain = sidechain;
    this.tools = new Map();
    this.plan = null;
    this.taskSeq = 0;
    this.seen = new Set();
    this.stats = { library: 0, dev: 0, server: 0, search: 0, meeting: 0, desk: 0, tools: 0, errors: 0, prompts: 0 };
    this.meta = { title: '', cwd: '', model: '', branch: '' };
    this.ctx = 0; // 마지막 답을 만들 때 읽은 컨텍스트 크기(토큰)
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
    const u = m.usage;
    if (u && m.model !== '<synthetic>') this.ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
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

module.exports = {
  ROOM_IDS, roomRules, ROOM_CONFIG, roomOf, ASK_TOOLS, contextWindow,
  clip, baseName, displayName, labelOf, detailOf, planFromMarkdown, Normalizer,
};
