// 회의실 화이트보드에 적을 할 일 고르기. 화면(DOM) 없이 테스트할 수 있게 따로 둔다.

export const BOARD_MAX = 14; // 화이트보드에 한꺼번에 적는 줄 수

// 할 일이 많으면 지금 하는 일 앞뒤만: 지금 하는 일(처음으로 안 끝난 일) 위로 세 줄을 남기고 14줄까지.
// 다 끝났으면 마지막(방금 끝낸 일들) 14줄
export function boardWindow(all, max = BOARD_MAX) {
  if (all.length <= max) return all;
  let cur = all.findIndex(i => i.status !== 'done');
  if (cur < 0) cur = all.length - 1;
  const start = Math.max(0, Math.min(cur - 3, all.length - max));
  return all.slice(start, start + max);
}

// 줄 수에 따라 글씨 크기 (많을수록 작게)
export const boardSize = n => (n > 6 ? 'xs' : n > 5 ? 's' : 'm');
