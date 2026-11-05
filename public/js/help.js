// ? 도움말 창 내용: 방이 뭘 하는 곳인지, 캐릭터 모습이 무슨 뜻인지, 무엇을 누르고 어떤 키를 쓰는지 한눈에.
// 새 기능을 넣으면 여기도 같이 고친다 (test/help.test.js가 빠진 게 없는지 본다).
import { ROOMS, ROOM_IDS } from './scene.js';
import { esc } from './util.js';

const rows = list => list.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

export const LOOKS = [
  ['💭 구름 말풍선', '생각하는 중'],
  ['😰 식은땀, 빨간 말풍선', '도구가 실패했어요'],
  ['🔐 허락서를 들고 내 자리에', '권한 확인 창이 떠서 내 허락을 기다려요 (hooks가 켜져 있을 때)'],
  ['🗜 지난 대화를 요약하는 중', '대화가 길어져서 압축하는 중이에요 (hooks가 켜져 있을 때)'],
  ['❓ 노란 말풍선', '나에게 물어볼 게 있어요'],
  ['✅ 완료', '답을 마치고 다음 지시를 기다려요'],
  ['😴 졸기', '한동안 할 일이 없어요'],
  ['⏳ 졸면서 기다리기', '사용 한도에 걸렸어요. 언제 다시 열리는지 같이 보여 줘요'],
  ['⚠ 일이 멈춤', '인터넷 끊김·로그인 만료 같은 오류로 멈췄어요. 다시 말을 걸면 이어서 해요'],
  ['📄 발치의 서류 더미', '컨텍스트가 찬 만큼 쌓여요 (20%마다 한 장, 노랑·빨강 포스트잇이면 곧 요약돼요)'],
  ['작은 캐릭터', '인턴 = 서브에이전트. 일을 마치면 퇴근해요'],
  ['📏 위쪽 막대', '컨텍스트가 얼마나 찼는지 (빨개지면 곧 요약돼요)'],
];

export const CLICKS = [
  ['캐릭터', '정보 카드: 지금 하는 일, 컨텍스트, 다시 보기·이 세션만 보기·이어 하기 명령 복사'],
  ['로비 안내판·활동 기록 줄', '그 사람이 있는 층으로 가서 정보 카드 열기'],
  ['활동 기록 · 이 층만', '지금 보는 층에서 한 일만 보기 (층이 둘 이상일 때)'],
  ['활동 기록 · 실패만', '실패·오류·중단만 모아 보기 (옆 숫자가 몇 번인지)'],
  ['층 버튼 · 🛗 자동', '층 고르기 · 일이 생기는 층으로 알아서'],
  ['⏪ 다시 보기', '세션을 처음부터 빠르게 (⏸ 멈춤, 10× 빠르기, 노란 막대를 누르면 건너뛰기)'],
  ['📓 업무 일지 · 로비의 📓 오늘', '오늘 한 일을 프로젝트별로, 시간대별 막대도 (◀ ▶나 ← → 키로 지난 날, 주간·월간으로 한 주·한 달 모아 보기 · 막대를 누르면 그 주·그날로, 📋로 마크다운 복사)'],
  ['🔔 알림', '다른 창을 볼 때 권한 대기·질문·응답 완료·사용 한도를 알려 줘요'],
];

export const KEYS = [
  ['<kbd>1</kbd>~<kbd>9</kbd> · <kbd>0</kbd>', '그 층으로 · 층 자동'],
  ['<kbd>Space</kbd> · <kbd>←</kbd> <kbd>→</kbd>', '다시 보기 멈추기 · 5%씩 앞뒤로'],
  ['<kbd>J</kbd> · <kbd>W</kbd> · <kbd>M</kbd>', '업무 일지 열기 · 닫기, 일지에서 한 주 · 한 달 모아 보기'],
  ['<kbd>Tab</kbd> · <kbd>Enter</kbd>', '로비 안내판·업무 일지 줄 고르기 · 열기'],
  ['<kbd>?</kbd> · <kbd>Esc</kbd>', '이 도움말 · 창 닫기'],
];

// 맨 위 hooks 상태 한 줄 (서버의 /api/hooks: { state, text, cmd })
export function hooksLine(h) {
  if (!h || !h.text || h.state === 'unknown') return '';
  const icon = h.state === 'on' || h.state === 'off' ? '🔌' : '⚠';
  const cmd = h.cmd ? `<br>터미널에서 <code>${esc(h.cmd)}</code>를 실행하고 Claude Code를 다시 켜 주세요.` : '';
  return `${icon} ${esc(h.text)}.${cmd}`;
}

export function helpHtml() {
  const rooms = ROOM_IDS.map(id => [`${ROOMS[id].icon} ${ROOMS[id].name}`, ROOMS[id].sub]);
  return `
    <p id="helpHooks" class="help-hooks" hidden></p>
    <h3>방</h3><dl>${rows(rooms)}</dl>
    <p class="help-tip">도구에 따라 캐릭터가 이 방들을 오가요. 처음 보는 도구는 이름을 보고 방을 골라요.</p>
    <h3>캐릭터 모습</h3><dl>${rows(LOOKS)}</dl>
    <h3>누르기</h3><dl>${rows(CLICKS)}</dl>
    <h3>단축키</h3><dl>${rows(KEYS)}</dl>`;
}
