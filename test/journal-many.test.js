// 하루에 세션이 많아도(데스크톱 앱 예약 작업처럼 자주 새로 열면) 업무 일지가 말없이 빼먹지 않는다.
// 전에는 하루에 60개까지만 읽어서, 80개면 그날 앞쪽 20개가 빠지고 일한 시간·도구가 덜 세졌다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CFG = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-many-'));
process.env.CLAUDE_CONFIG_DIR = CFG;
const { journal } = require('../lib/sessions');
test.after(() => fs.rmSync(CFG, { recursive: true, force: true }));

test('하루 세션 80개를 다 센다 (전에는 60개)', async () => {
  const dir = path.join(CFG, 'projects', '-tmp-many');
  fs.mkdirSync(dir, { recursive: true });
  const since = new Date().setHours(0, 0, 0, 0);
  const step = (Date.now() - since - 5000) / 80; // 오늘 0시와 지금 사이에 고르게 (자정 바로 뒤에 돌려도 오늘 안에)
  for (let i = 0; i < 80; i++) {
    const t0 = Math.round(since + 1000 + i * step);
    const L = o => JSON.stringify({ cwd: '/tmp/many', ...o });
    const f = path.join(dir, `bbbbbbbb-0000-0000-0000-${String(i).padStart(12, '0')}.jsonl`);
    fs.writeFileSync(f, [
      L({ type: 'user', uuid: 'u' + i, timestamp: new Date(t0).toISOString(), message: { role: 'user', content: '일 ' + i } }),
      L({ type: 'assistant', uuid: 'a' + i, timestamp: new Date(t0 + 1000).toISOString(), message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 't' + i, name: 'Read', input: { file_path: '/tmp/many/x' } }] } }),
    ].join('\n') + '\n');
    const m = new Date(t0 + 1000);
    fs.utimesSync(f, m, m);
  }
  const j = await journal(0);
  assert.equal(j.projects.reduce((n, p) => n + p.sessions.length, 0), 80);
  assert.equal(j.totals.tools, 80);
  assert.equal(j.left, 0);
});

test('그래도 너무 많아 빼고 셌으면 일지에 그렇다고 적는다', async () => {
  const { journalText, journalMarkdown } = require('../lib/report');
  const { dayView } = await import('../public/js/journal-view.js');
  const P = { project: 'many', cwd: '/tmp/many', first: 0, last: 0, workedMs: 60000, prompts: 1, tools: 1, errors: 0, interns: 0, tokens: 0, rooms: { library: 1, dev: 0, server: 0, search: 0, meeting: 0, desk: 0 }, sessions: [] };
  const j = { since: Date.now(), today: true, hours: Array(24).fill(0), totals: { workedMs: 60000, projects: 1, sessions: 1, prompts: 1, tools: 1, errors: 0, interns: 0, tokens: 0 }, projects: [P], left: 7 };
  assert.match(journalText(j), /⚠ 세션이 너무 많아서 오래된 7개는 빼고 셌어요/);
  assert.match(journalMarkdown(j), /> 세션이 너무 많아서 오래된 7개는 빼고 셌어요/);
  assert.match(dayView(j).list, /오래된 7개는 빼고 셌어요/);
  assert.doesNotMatch(journalText({ ...j, left: 0 }), /빼고 셌어요/);
});
