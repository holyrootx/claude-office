// 업무 일지의 일한 시간: 인턴(서브에이전트)이 오래 일하는 동안 메인 기록이 조용해도 일한 걸로 센다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 내 진짜 기록이 아니라 빈 임시 폴더를 읽게 한다 (config가 불릴 때 읽으니까 require보다 먼저)
const CFG = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-work-'));
process.env.CLAUDE_CONFIG_DIR = CFG;
const { journal } = require('../lib/sessions');

test.after(() => fs.rmSync(CFG, { recursive: true, force: true }));

test('인턴이 20분 동안 일하는 사이 메인 기록이 조용해도 그 20분을 일한 시간으로 센다', async () => {
  const dir = path.join(CFG, 'projects', '-tmp-shop');
  const sid = '33333333-0000-0000-0000-000000000000';
  fs.mkdirSync(path.join(dir, sid, 'subagents'), { recursive: true });
  // 30분 전에 시작한 일. 다만 자정 직후에 돌리면 어제로 넘어가니 오늘 0시 1분보다 앞으로는 가지 않는다
  // (일지는 그날 뒤에 생긴 파일은 보지 않아서 어제 날짜로 옮길 수는 없다)
  const midnight = new Date().setHours(0, 0, 0, 0);
  const t0 = Math.max(midnight + 60000, Date.now() - 30 * 60000);
  const at = m => new Date(t0 + m * 60000).toISOString();
  const lines = list => list.map(o => JSON.stringify({ cwd: '/tmp/shop', ...o })).join('\n') + '\n';
  // 메인: 0분에 인턴에게 맡기고, 20분에 결과를 받는다 (그 사이 기록 없음)
  fs.writeFileSync(path.join(dir, sid + '.jsonl'), lines([
    { type: 'user', uuid: 'u', timestamp: at(0), message: { role: 'user', content: '조사해 줘' } },
    { type: 'assistant', uuid: 'a', timestamp: at(0), message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'ag', name: 'Agent', input: { description: '조사' } }] } },
    { type: 'user', uuid: 'r', timestamp: at(20), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'ag', content: 'done' }] } },
  ]));
  // 인턴: 2분마다 도구를 쓴다
  const sub = [];
  for (let m = 1; m <= 19; m += 2) sub.push({ type: 'assistant', isSidechain: true, uuid: 's' + m, timestamp: at(m), message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'g' + m, name: 'Grep', input: { pattern: 'x' } }] } });
  fs.writeFileSync(path.join(dir, sid, 'subagents', 'agent-x.jsonl'), lines(sub));
  const j = await journal();
  const minutes = Math.round(j.projects[0].workedMs / 60000);
  assert.equal(minutes, 20); // 메인만 보면 0분 (0분 → 20분 간격이 5분보다 길다)
});
