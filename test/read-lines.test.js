// 기록을 1MB 조각으로 읽어 줄로 나누는 부분(lib/sessions.js readLinesSync·readLinesAsync).
// 조각을 담는 버퍼를 다시 써서 메모리를 아끼되, 조각 경계에 걸린 한글 글자가 깨지면 안 된다
// (처음 고쳤을 때 '중요한'이 '���요한'으로 깨진 적이 있다: 경계를 넘어온 바이트를 따로 글자로 바꿔서).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-lines-'));
process.env.CLAUDE_CONFIG_DIR = TMP;
const { readLinesSync, readLinesAsync, CHUNK } = require('../lib/sessions');
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// 조각 경계(CHUNK, 2*CHUNK)마다 3바이트 글자('중')가 걸치도록 줄을 만든다
function makeFile() {
  const lines = [];
  let bytes = 0;
  const add = s => { lines.push(s); bytes += Buffer.byteLength(s) + 1; };
  add('{"a":"첫 줄"}');
  for (const edge of [CHUNK, 2 * CHUNK]) {
    const prefix = '{"t":"';
    const pad = edge - bytes - Buffer.byteLength(prefix) - 1; // '중'의 첫 바이트가 경계 바로 앞에 오게
    add(prefix + 'x'.repeat(pad) + '중요한 일"}');
  }
  add('{"z":"끝 줄 — 한글 섞인 마지막"}');
  const tail = '{"partial":"줄바꿈 없이 끝난';
  const file = path.join(TMP, 'big.jsonl');
  fs.writeFileSync(file, lines.join('\n') + '\n' + tail);
  return { file, lines, tail, size: fs.statSync(file).size };
}

test('조각 경계에 걸친 한글 글자도 그대로, 줄바꿈 없이 끝난 마지막 조각은 carry로 (동기·비동기 같게)', async () => {
  const { file, lines, tail, size } = makeFile();
  assert.ok(size > 2 * CHUNK);
  const got = [];
  const sp = readLinesSync(file, 0, size, ls => got.push(...ls));
  assert.deepEqual(got, lines);
  assert.equal(sp.carry.toString('utf8'), tail);
  assert.equal(sp.read, size);
  assert.equal(sp.firstNl, Buffer.byteLength(lines[0]));
  const got2 = [];
  const sp2 = await readLinesAsync(file, 0, size, ls => got2.push(...ls));
  assert.deepEqual(got2, lines);
  assert.equal(sp2.carry.toString('utf8'), tail);
  // 중간부터 읽어도(끝부분만 읽기) 첫 줄바꿈 자리를 안다
  const from = CHUNK - 5;
  const part = [];
  const sp3 = readLinesSync(file, from, size, ls => part.push(...ls));
  assert.equal(part.slice(1).join('\n'), lines.slice(2).join('\n')); // 첫 줄은 잘린 줄
  assert.equal(sp3.firstNl, fs.readFileSync(file).indexOf(0x0a, from));
});

test('비동기로 읽다가 false를 돌려주면 그만 읽는다', async () => {
  const { file, size } = makeFile();
  let calls = 0;
  await readLinesAsync(file, 0, size, () => { calls++; return false; });
  assert.equal(calls, 1);
});
