// 층(프로젝트)에 관한 판단: 처음 볼 층, 자동으로 옮겨 갈 층, 층 이름. 화면과 떨어져 있어서 테스트할 수 있다.
// actors는 { floor, waitState, status, lastActivity, lastEventTs }만 있으면 된다.

export const QUIET_MS = 15000; // 지금 층이 이만큼 조용하면
export const FRESH_MS = 4000; // 다른 층에서 이만큼 안에 일이 생겼을 때 옮겨 간다

const needsMe = a => !!a.waitState || a.status === 'ask';

// 처음 볼 층: 나를 기다리는 직원이 있는 층, 없으면 가장 최근에 일한 층
export function firstFloor(actors, floorKeys = []) {
  let best = null;
  for (const a of actors) {
    if (!best || (!!a.waitState > !!best.waitState) || (!!a.waitState === !!best.waitState && a.lastEventTs > best.lastEventTs)) best = a;
  }
  return best ? best.floor : floorKeys[0] || null;
}

// 자동으로 옮겨 갈 층 (옮기지 않으면 null)
// - 지금 층에 나를 기다리는 사람이 있으면 그대로
// - 다른 층에서 누가 나를 기다리면 바로 그리로
// - 지금 층이 15초 넘게 조용하고 다른 층에서 방금(4초 안) 일이 생겼으면 그리로
export function nextFloor(current, actors, now = Date.now()) {
  const list = [...actors];
  const here = list.filter(a => a.floor === current);
  if (here.some(needsMe)) return null;
  const waiting = list.find(a => a.floor !== current && needsMe(a));
  if (waiting) return waiting.floor;
  if (now - Math.max(0, ...here.map(a => a.lastActivity || 0)) < QUIET_MS) return null;
  let best = null;
  for (const a of list) if (a.floor !== current && now - a.lastActivity < FRESH_MS && (!best || a.lastActivity > best.lastActivity)) best = a;
  return best ? best.floor : null;
}

// 층 이름: 이름이 같은 층(다른 곳의 같은 이름 폴더)이 있으면 바로 위 폴더 이름을 붙여 구별한다 (blog · work)
// floors: Map(key → { name })
export function floorLabel(floors, key) {
  const f = floors.get(key);
  if (!f) return '';
  const twin = [...floors.values()].some(o => o !== f && o.name === f.name);
  if (!twin) return f.name;
  const parent = String(key).split(/[\\/]/).filter(Boolean).slice(-2, -1)[0];
  return parent ? `${f.name} · ${parent}` : f.name;
}
