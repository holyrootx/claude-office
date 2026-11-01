#!/usr/bin/env node
// 내 컴퓨터의 실제 세션 기록으로 사무실을 점검한다. 기록은 어디에도 보내지 않고 읽기만 한다.
// - 모든 세션을 처음부터 읽어 이벤트로 바꿔 보고, 다시 보기와 업무 일지를 만들어 본다
// - 사무실이 아직 모르는 기록 종류가 있으면 알려 준다 (Claude Code가 새 기록을 남기기 시작했다는 뜻)
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
]);
const KNOWN_SYSTEM = new Set(['compact_boundary', 'stop_hook_summary', 'turn_duration', 'api_error']);

const fmt = n => n.toLocaleString();

async function scanFile(file, sidechain) {
  const norm = new Normalizer({ sidechain });
  const unknown = new Map();
  let events = 0, lines = 0, broken = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const l of rl) {
    if (!l) continue;
    lines++;
    let j;
    try { j = JSON.parse(l); } catch { broken++; continue; }
    const kind = j.type === 'system' ? (KNOWN_SYSTEM.has(j.subtype) ? null : `system:${j.subtype}`) : KNOWN_TYPES.has(j.type) ? null : String(j.type);
    if (kind) unknown.set(kind, (unknown.get(kind) || 0) + 1);
    events += norm.line(l).length;
  }
  return { events, lines, broken, unknown };
}

(async () => {
  const sessions = scanSessions();
  console.log(`\n  🔎 ${PROJECTS} 의 세션 ${sessions.length}개를 점검해요 (읽기만 해요)\n`);
  const unknown = new Map();
  const problems = [];
  let events = 0, lines = 0, broken = 0;
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
        for (const [k, n] of r.unknown) unknown.set(k, (unknown.get(k) || 0) + n);
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
  if (problems.length) {
    console.log('\n  ⚠ 문제:');
    for (const p of problems) console.log('     ' + p);
    process.exitCode = 1;
  } else console.log('  다시 보기·업무 일지: 문제 없음');
  console.log('');
})();
