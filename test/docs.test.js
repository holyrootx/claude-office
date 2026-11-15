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

// GitHub가 제목에 붙이는 이름(#앵커): 소문자로, 글자·숫자·공백·-·_만 남기고 공백은 -로 (이모지·문장 부호는 빠진다)
const slug = h => h.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/ /g, '-');
test('README 안의 #링크는 모두 있는 제목을 가리킨다 (제목을 고치면 링크가 깨지기 쉬워서)', () => {
  const md = read('README.md');
  const seen = new Map();
  const anchors = new Set();
  for (const [, h] of md.matchAll(/^#{1,6} (.+)$/gm)) {
    const base = h.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/^ +| +$/g, (m, i) => (i === 0 ? '-'.repeat(m.length) : '')).replace(/ /g, '-');
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    anchors.add(n ? `${base}-${n}` : base);
    anchors.add(slug(h)); // 앞의 이모지가 빠진 꼴도 (GitHub는 앞에 -가 남는다)
  }
  const broken = [...md.matchAll(/\]\(#([^)]+)\)/g)].map(m => decodeURIComponent(m[1])).filter(a => !anchors.has(a));
  assert.deepEqual(broken, []);
});
