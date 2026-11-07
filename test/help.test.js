// ? 도움말(public/js/help.js)에 방과 주요 기능이 빠짐없이 들어 있는지 본다.
// 새 기능을 넣고 도움말을 깜빡하면 여기서 걸린다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

let helpHtml, ROOMS;
test.before(async () => {
  ({ helpHtml } = await import('../public/js/help.js'));
  ({ ROOMS } = await import('../public/js/scene.js'));
});

test('여섯 방이 모두 나온다', () => {
  const html = helpHtml();
  for (const r of Object.values(ROOMS)) assert.ok(html.includes(r.name), r.name);
});

test('주요 기능과 캐릭터 모습이 빠지지 않았다', () => {
  const html = helpHtml();
  for (const word of ['권한 확인', '물어볼 게', '사용 한도', '오류로 멈췄어요', '서류 더미', '인턴', '이어 하기 명령 복사', '이 층만', '실패만', '다시 보기', '업무 일지', '마크다운 복사', '알림', '<kbd>Esc</kbd>', '<kbd>J</kbd>']) {
    assert.ok(html.includes(word), word);
  }
});

test('도움말 맨 위 hooks 한 줄: 꺼져 있으면 무엇을 실행할지, 켜져 있으면 짧게', async () => {
  const { hooksLine } = await import('../public/js/help.js');
  const off = hooksLine({ state: 'off', text: '권한 확인 대기·대화 압축 중까지 보려면 hooks를 켜 주세요', cmd: 'node server.js --install-hooks' });
  assert.match(off, /^🔌 .*켜 주세요\.<br>터미널에서 <code>node server\.js --install-hooks<\/code>를 실행하고/);
  assert.match(off, /<button type="button" class="hooks-copy" data-cmd="node server\.js --install-hooks">📋 명령 복사<\/button>/);
  assert.equal(hooksLine({ state: 'on', text: 'hooks가 켜져 있어요', cmd: '' }), '🔌 hooks가 켜져 있어요.');
  assert.match(hooksLine({ state: 'stale', text: 'PreCompact가 <빠져> 있어요', cmd: 'x' }), /^⚠ PreCompact가 &lt;빠져&gt;/);
  assert.equal(hooksLine({ state: 'unknown', text: '', cmd: '' }), '');
  assert.equal(hooksLine(null), '');
});
