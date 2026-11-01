// 하루에 이벤트가 아주 많은 세션(12만 개 넘게)도 업무 일지가 터지지 않는지 본다.
// Math.max(...긴 배열)처럼 인자를 한꺼번에 펼치면 V8에서는 12만 개쯤에서 'Maximum call stack size exceeded'가 난다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 내 진짜 기록이 아니라 빈 임시 폴더를 읽게 한다 (config가 불릴 때 읽으니까 require보다 먼저)
const CFG = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-big-'));
process.env.CLAUDE_CONFIG_DIR = CFG;
const { journal } = require('../lib/sessions');

test.after(() => fs.rmSync(CFG, { recursive: true, force: true }));

test('하루 이벤트가 13만 개가 넘어도 업무 일지를 만든다', async () => {
  const dir = path.join(CFG, 'projects', '-tmp-huge');
  fs.mkdirSync(dir, { recursive: true });
  const N = 135000;
  const ts = new Date(Date.now() - 1000).toISOString();
  const line = i => `{"type":"assistant","timestamp":"${ts}","cwd":"/tmp/huge","message":{"content":[{"type":"tool_use","id":"t${i}","name":"Read","input":{}}]}}`;
  fs.writeFileSync(path.join(dir, '22222222-0000-0000-0000-000000000000.jsonl'), Array.from({ length: N }, (_, i) => line(i)).join('\n') + '\n');
  const j = await journal();
  assert.equal(j.projects.length, 1);
  assert.equal(j.projects[0].tools, N);
  assert.equal(j.projects[0].sessions[0].last, Date.parse(ts));
});
