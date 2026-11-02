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
  for (const word of ['권한 확인', '물어볼 게', '사용 한도', '오류로 멈췄어요', '서류 더미', '인턴', '이어 하기 명령 복사', '이 층만', '다시 보기', '업무 일지', '마크다운 복사', '알림', '<kbd>Esc</kbd>']) {
    assert.ok(html.includes(word), word);
  }
});
