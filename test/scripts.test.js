// scripts/ 아래 스크립트(check-local·screenshot)는 내 실제 기록이나 Chrome이 있어야 돌아서 npm test가 실행하지 않는다.
// 그래도 문법이 깨지면 바로 알 수 있게 node --check로 읽히는지만 본다 (주석이 닫는 괄호를 삼킨 적이 있다).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = path.join(__dirname, '..', 'scripts');

test('scripts/의 스크립트가 문법 오류 없이 읽힌다', () => {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.js'));
  assert.ok(files.length >= 2);
  for (const f of files) {
    try { execFileSync(process.execPath, ['--check', path.join(DIR, f)], { stdio: 'pipe' }); } catch (e) { assert.fail(`${f}: ${String(e.stderr).split('\n').find(l => /Error/.test(l)) || e.message}`); }
  }
});
