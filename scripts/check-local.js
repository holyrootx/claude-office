#!/usr/bin/env node
// 내 컴퓨터의 실제 세션 기록으로 사무실을 점검한다. 기록은 어디에도 보내지 않고 읽기만 한다.
// - 모든 세션을 처음부터 읽어 이벤트로 바꿔 보고, 다시 보기와 업무 일지를 만들어 본다
// - 사무실이 아직 모르는 기록 종류가 있으면 알려 준다 (Claude Code가 새 기록을 남기기 시작했다는 뜻)
// - 고칠 거리를 찾는 데 쓰는 숫자도 보여 준다: 표지판 글이 없는 도구, 화면에 안 보이고 버려지는 숨김 user 줄
//   (내용은 찍지 않고 종류와 개수만)
// 문제가 있으면 exit 1.   사용법: npm run check-local
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { PROJECTS } = require('../lib/config');
const { Normalizer } = require('../lib/normalize');
const { scanSessions, replayOf, journal } = require('../lib/sessions');

// 화면에 쓰거나, 일부러 쓰지 않기로 한 기록 종류
const KNOWN_TYPES = new Set([
  'user', 'assistant', 'system', 'summary', 'custom-title', 'ai-title', 'agent-name', 'last-prompt',
  'queue-operation', 'pr-link', 'cost-state', 'mode', 'attachment', 'file-history-snapshot', 'file-history-delta',
  'atis-latch', 'bridge-session', 'frame-link', 'artifact-comment-monitor', 'artifact-autoreact-ledger',
  'api-request', 'api-request-blob', 'api-request-shape', // 디버그용 API 요청 기록 (화면에 보일 게 없다)
  'relocated', // 데스크톱 앱이 남기는 '이 세션의 폴더'(relocatedCwd). 층을 정할 때 힌트로 쓴다
  'tools-used', // 이번까지 쓴 도구 이름 목록 (도구는 assistant 줄에서 이미 센다)
]);
// informational: '자리 비운 동안 쓴 요약으로 압축했어요' 같은 안내. 압축은 compact_boundary(precomputed)로 이미 안다
const KNOWN_SYSTEM = new Set(['compact_boundary', 'stop_hook_summary', 'turn_duration', 'api_error', 'informational']);

const fmt = n => n.toLocaleString();

const bump = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);

async function scanFile(file, sidechain) {
  const norm = new Normalizer({ sidechain });
  const unknown = new Map(), noLabel = new Map(), hidden = new Map();
  let events = 0, lines = 0, broken = 0, tools = 0;
  // 우리말로 못 바꾼 것들: 이름을 모르는 커넥터 도구(MCP.…), 글자가 모두 영어인 API 오류·실패 안내 (내용은 세지 않고 개수만)
  let mcpUnknown = 0, apiEnglish = 0, failEnglish = 0, fails = 0;
  const english = t => /[a-z]{3}/i.test(t) && !/[가-힣]/.test(t);
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const l of rl) {
    if (!l) continue;
    lines++;
    let j;
    try { j = JSON.parse(l); } catch { broken++; continue; }
    const kind = j.type === 'system' ? (KNOWN_SYSTEM.has(j.subtype) ? null : `system:${j.subtype}`) : KNOWN_TYPES.has(j.type) ? null : String(j.type);
    if (kind) bump(unknown, kind);
    const evs = norm.line(l);
    events += evs.length;
    for (const e of evs) {
      if (e.k === 'apierr' && english(e.text || '')) apiEnglish++;
      // 영어 문장 그대로인 실패 안내 (명령의 Exit code 줄은 빼고)
      if (e.k === 'result' && !e.ok) { fails++; if (/^[A-Z][a-z]+ [a-z]/.test(e.error || '') && !/^Exit code/.test(e.error) && !/[가-힣]/.test(e.error)) failEnglish++; }
      if (e.k !== 'tool') continue;
      tools++;
      if (/^MCP\./.test(e.tool)) mcpUnknown++;
      if (!e.label && !e.detail) bump(noLabel, e.name.replace(/^mcp__[0-9a-f-]{36}__/, 'mcp__(커넥터)__'));
    }
    // 사람이 볼 글이 든 숨김(isMeta) user 줄인데 아무 이벤트도 안 됐으면: 어디서 온 건지만 센다
    const c = j.message && j.message.content;
    if (j.type === 'user' && j.isMeta && !evs.length && typeof c === 'string' && c.trim()) {
      bump(hidden, (j.origin && j.origin.kind) || j.turnOrigin || j.promptSource || '출처 표시 없음');
    }
  }
  return { events, lines, broken, unknown, tools, noLabel, hidden, mcpUnknown, apiEnglish, failEnglish, fails, mode: !sidechain && norm.meta.mode };
}

(async () => {
  const sessions = scanSessions();
  console.log(`\n  🔎 ${PROJECTS} 의 세션 ${sessions.length}개를 점검해요 (읽기만 해요)\n`);
  const unknown = new Map(), noLabel = new Map(), hidden = new Map();
  const problems = [];
  let events = 0, lines = 0, broken = 0, tools = 0, mcpUnknown = 0, apiEnglish = 0, failEnglish = 0, fails = 0, noMode = 0;
  for (const s of sessions) {
    const name = path.basename(s.file);
    const files = [[s.file, false]];
    const sub = path.join(path.dirname(s.file), path.basename(s.file, '.jsonl'), 'subagents');
    try { for (const f of fs.readdirSync(sub)) if (f.endsWith('.jsonl')) files.push([path.join(sub, f), true]); } catch { /* 서브에이전트 없음 */ }
    for (const [f, sidechain] of files) {
      try {
        const r = await scanFile(f, sidechain);
        events += r.events;
        lines += r.lines;
        broken += r.broken;
        tools += r.tools;
        mcpUnknown += r.mcpUnknown; apiEnglish += r.apiEnglish; failEnglish += r.failEnglish; fails += r.fails;
        if (!sidechain && !r.mode) noMode++;
        for (const [k, n] of r.unknown) bump(unknown, k, n);
        for (const [k, n] of r.noLabel) bump(noLabel, k, n);
        for (const [k, n] of r.hidden) bump(hidden, k, n);
      } catch (e) {
        problems.push(`${name}: 읽다가 오류 — ${e.message}`);
      }
    }
    try {
      const r = await replayOf(s.file);
      if (!r || !Array.isArray(r.events)) problems.push(`${name}: 다시 보기를 만들지 못했어요`);
    } catch (e) {
      problems.push(`${name}: 다시 보기 오류 — ${e.message}`);
    }
  }
  try { await journal(); } catch (e) { problems.push(`업무 일지 오류 — ${e.message}`); }

  console.log(`  기록 ${fmt(lines)}줄 → 이벤트 ${fmt(events)}개${broken ? ` (읽지 못한 줄 ${fmt(broken)}개: 쓰는 중이던 마지막 줄일 수 있어요)` : ''}`);
  if (unknown.size) {
    console.log('\n  🆕 사무실이 아직 모르는 기록 종류가 있어요 (Claude Code가 새로 남기기 시작한 것일 수 있어요):');
    for (const [k, n] of [...unknown].sort((a, b) => b[1] - a[1])) console.log(`     ${k}  ${fmt(n)}개`);
  } else console.log('  모르는 기록 종류: 없음');
  // 고칠 거리 찾기용 (문제는 아니에요)
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${fmt(v)}`).join(', ');
  const sum = m => [...m.values()].reduce((a, b) => a + b, 0);
  console.log(`  표지판 글이 없는 도구: ${fmt(sum(noLabel))}개 / 도구 ${fmt(tools)}개${noLabel.size ? ` (많은 순: ${top(noLabel, 5)})` : ''}`);
  console.log(`  화면에 안 보이는 숨김 user 줄: ${fmt(sum(hidden))}개${hidden.size ? ` (어디서: ${top(hidden, 5)})` : ''}`);
  console.log(`  이름을 모르는 커넥터 도구(MCP.…): ${fmt(mcpUnknown)}번 · 영어 그대로인 API 오류: ${fmt(apiEnglish)}줄 · 영어 문장 그대로인 실패 안내: ${fmt(failEnglish)}건 / 실패 ${fmt(fails)}건 (도구가 낸 오류도 있어요)`);
  console.log(`  권한 모드를 모르는 세션: ${fmt(noMode)}개 / ${fmt(sessions.length)}개 (정보 카드의 🛡)`);
  if (problems.length) {
    console.log('\n  ⚠ 문제:');
    for (const p of problems) console.log('     ' + p);
    process.exitCode = 1;
  } else console.log('  다시 보기·업무 일지: 문제 없음');
  console.log('');
})();
