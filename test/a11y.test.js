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

test('무대의 장식(캐릭터·방 표지판·말풍선·"나")은 화면 읽기 프로그램에서 숨기고, 정보 카드·안내는 숨기지 않는다', () => {
  for (const id of ['signs', 'userBubble', 'actors']) assert.match(html, new RegExp(`id="${id}"[^>]*aria-hidden="true"`), id);
  assert.match(html, /class="me-tag" aria-hidden="true"/);
  for (const id of ['card', 'floorToast', 'board']) assert.doesNotMatch(html, new RegExp(`id="${id}"[^>]*aria-hidden`), id);
});

test('키보드: 버튼·로비 줄에 초점이 있으면 Space는 그걸 누르고, 다시 보기 멈춤 단축키는 그때 끼어들지 않는다', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  // 전에는 다시 보기 중 10× 버튼에서 Space를 누르면 단축키가 preventDefault를 해서 버튼은 안 눌리고 멈추기만 했다
  assert.match(app, /const onControl = e\.target\.closest && e\.target\.closest\('button, a\[href\], \[role="button"\]'\);/);
  assert.match(app, /if \(replay\.isOn\(\) && e\.key === ' ' && !onControl\)/);
  // role="button"인 로비 줄은 Enter와 Space 둘 다
  assert.match(app, /\$\('lobby'\)\.addEventListener\('keydown', e => \{\n\s+if \(e\.key !== 'Enter' && e\.key !== ' '\) return;/);
});

test('다시 보기 진행 막대는 화면 읽기 프로그램이 슬라이더로 읽고, 키보드로 고를 수 있다', () => {
  assert.match(html, /id="replayBar"[^>]*role="slider"[^>]*tabindex="0"[^>]*aria-label="다시 보기 진행[^"]*"[^>]*aria-valuemin="0"[^>]*aria-valuemax="100"/);
  const replay = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'replay.js'), 'utf8');
  assert.match(replay, /setAttribute\('aria-valuenow'/);
  assert.match(replay, /setAttribute\('aria-valuetext'/);
  // 슬라이더 키: 막대에 초점이 있을 때 Home·End·PageUp·PageDown
  assert.match(replay, /\$\('replayBar'\)\.addEventListener\('keydown'[\s\S]*Home:[\s\S]*End:[\s\S]*PageUp:[\s\S]*PageDown:/);
});
