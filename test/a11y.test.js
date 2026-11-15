// 화면 읽기 프로그램용 이름: 아이콘(이모지·기호)만 있는 버튼은 aria-label이 있어야 한다.
// 없으면 '📓'은 '공책', '?'는 '물음표'처럼 읽혀서 무슨 버튼인지 알 수 없다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('아이콘만 있는 버튼에는 aria-label이 있다', () => {
  const bad = [];
  for (const [, attrs, inner] of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    if (!text || /[가-힣A-Za-z]/.test(text)) continue; // 글자가 있으면 그 글자로 읽는다 (비어 있으면 화면이 글을 채운다: 📓 오늘 3시간…)
    if (!/\baria-label="[^"]+"/.test(attrs)) bad.push(`${(attrs.match(/id="([^"]+)"/) || [])[1] || attrs.trim()}: ${text}`);
  }
  assert.deepEqual(bad, []);
});
