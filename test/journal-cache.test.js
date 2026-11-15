// 업무 일지는 읽은 세션 기록을 요청 사이에도 들고 있다가, 파일이 자라면 붙은 줄만 이어 읽는다 (lib/sessions.js readForJournal).
// 이어 읽어도 처음부터 읽은 것과 같은 숫자가 나오는지, 파일이 다시 쓰이거나 아주 커도 맞는지 본다.
// (일지는 그날이 끝난 뒤에 만든 파일은 건너뛰니까, 기록은 모두 오늘 것으로 쓴다)
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 내 진짜 기록이 아니라 빈 임시 폴더를 읽게 한다 (config가 불릴 때 읽으니까 require보다 먼저)
const CFG = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-jcache-'));
process.env.CLAUDE_CONFIG_DIR = CFG;
const { journal, dayRange } = require('../lib/sessions');

test.after(() => fs.rmSync(CFG, { recursive: true, force: true }));

const DIR = path.join(CFG, 'projects', '-tmp-shop');
fs.mkdirSync(DIR, { recursive: true });
// 오늘 0시를 넘긴 시각 (자정 직후에 돌려도 어제로 넘어가지 않게)
const today = (ago = 60000) => new Date(Math.max(Date.now() - ago, dayRange(0).since + 1000)).toISOString();
const tool = (id, ts = today()) => JSON.stringify({ type: 'assistant', timestamp: ts, cwd: '/tmp/shop', message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: '/tmp/shop/a.js' } }] } }) + '\n';
const tools = j => j.projects.reduce((n, p) => n + p.tools, 0);

test('파일이 자라면 붙은 줄만 이어 읽어도 처음부터 읽은 것과 같은 숫자가 나오고, 다시 쓰이면 새로 읽는다', async () => {
  const file = path.join(DIR, '33333333-0000-0000-0000-000000000001.jsonl');
  try {
    fs.writeFileSync(file, tool('a'));
    assert.equal(tools(await journal(0)), 1);
    fs.appendFileSync(file, tool('b') + tool('c'));
    assert.equal(tools(await journal(0)), 3);
    assert.equal(tools(await journal(0)), 3); // 그대로면 그대로
    // 다시 쓰여서 작아지면 처음부터 다시 읽는다
    fs.writeFileSync(file, tool('d'));
    assert.equal(tools(await journal(0)), 1);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('끝부분(8MB)만 읽어서 모자라면 처음부터 흘려 읽고, 그 뒤로도 이어 읽는다', async () => {
  const file = path.join(DIR, '33333333-0000-0000-0000-000000000002.jsonl');
  try {
    // 오늘 이른 시각의 도구 하나, 그 뒤로 말이 9MB쯤 (끝부분 8MB에는 첫 도구가 안 들어간다)
    const say = JSON.stringify({ type: 'assistant', timestamp: today(), cwd: '/tmp/shop', message: { content: [{ type: 'text', text: 'x'.repeat(10000) }] } }) + '\n';
    fs.writeFileSync(file, tool('early', today(3600000)) + say.repeat(900) + tool('late'));
    assert.equal(tools(await journal(0)), 2); // 앞부분을 흘려 읽어서 첫 도구도 센다
    fs.appendFileSync(file, tool('more'));
    assert.equal(tools(await journal(0)), 3); // 처음부터 읽은 뒤로도 붙은 줄을 이어 읽는다
  } finally {
    fs.rmSync(file, { force: true });
  }
});
