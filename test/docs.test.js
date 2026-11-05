// 버전을 올릴 때 함께 고쳐야 하는 글: README 방법 A의 npx 주소(?v=버전), CHANGELOG의 그 버전 줄, 플러그인 버전
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { version } = require('../package.json');

test('README의 npx 명령에 지금 버전이 붙어 있다 (npx는 주소가 같으면 새로 받지 않아서)', () => {
  assert.ok(read('README.md').includes(`npx https://github.com/holyrootx/claude-office/archive/refs/heads/main.tar.gz?v=${version}\n`));
});

test('CHANGELOG에 지금 버전이 있고, 플러그인 버전도 같다', () => {
  assert.match(read('CHANGELOG.md'), new RegExp(`^## ${version.replace(/\./g, '\\.')}$`, 'm'));
  assert.equal(JSON.parse(read('.claude-plugin/plugin.json')).version, version);
});
