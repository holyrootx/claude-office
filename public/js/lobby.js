// 로비 안내판에 들어갈 줄들. 층마다 직원·인턴 한 줄씩, 나를 기다리는 사람이 맨 위.
// 화면(DOM) 없이 글자만 만들어서 테스트할 수 있다. 초점 지키기 같은 화면 일은 app.js가 한다.
import { esc, clip, ago, ctxOf, schedText, schedTip } from './util.js';

// 나를 기다리는 순서 (작을수록 위). 나머지는 모두 같은 순위라 층 순서대로 선다.
const STATUS_ORDER = { wait: 0, ask: 1 };

// 화면 읽기 프로그램용 글도 막대 안에 숨겨 둔다: 로비 줄(버튼)의 이름은 안의 글로 정해지는데, 막대에는 마우스를 올려야
// 보이는 글(title)뿐이라 컨텍스트가 얼마나 찼는지는 읽지 않았다
const ctxBar = c => (c ? `<i class="ctx ${c.level}" style="--p:${c.p}%" title="컨텍스트 ${c.p}% · ${esc(c.text)}"><span class="sr-only"> · 컨텍스트 ${c.p}%</span></i>` : '');

// 시간 칸: 지금 하는 일이 몇 초째인지, 사용 한도면 풀리는 때, 쉬거나 멈췄으면 마지막으로 일한 때
export function lobbyTime(a, st = a.status) {
  if (a.now.time) return a.now.time;
  if (st === 'limit' && a.halt && a.halt.resets) return `~${a.halt.resets}`;
  if ((st === 'idle' || st === 'sleep' || st === 'stopped') && a.lastEventTs) return ago(a.lastEventTs);
  return '';
}

// floors: [{ key, sids }] (이 순서가 1층, 2층…), sessions: Map(세션 id → 세션), current: 보고 있는 층 key
export function lobbyHtml(floors, sessions, current, now = Date.now()) {
  const rows = [];
  floors.forEach((f, i) => {
    for (const sid of f.sids) {
      const s = sessions.get(sid);
      if (!s) continue;
      for (const a of [s.main, ...s.interns.values()]) {
        if (a.leaving) continue;
        const st = a.status;
        const queue = !a.intern && s.info.queue && s.info.queue.length
          ? ` <small class="q" title="Claude가 바쁠 때 들어와서 기다리는 메시지 (내 말·예약 작업·알림)">📨${s.info.queue.length}</small>` : '';
        // 쉬는 동안에는 다음 예약 작업이 언제 도는지 (크론·/loop로 돌리는 세션)
        const next = !a.intern && (st === 'idle' || st === 'sleep') && !a.ended && schedText(s.info.sched, now, true);
        const sched = next ? ` <small class="q next" title="${esc(schedTip(s.info.sched))}">${esc(next)}</small>` : '';
        rows.push({
          rank: STATUS_ORDER[st] ?? 2, floor: i,
          html: `<li class="lb ${st}${a.floor === current ? ' here' : ''}${a.intern ? ' intern' : ''}" data-floor="${esc(f.key)}" data-actor="${esc(a.key)}" tabindex="0" role="button" style="--wc:${esc(s.color)}">`
            + `<b>${i + 1}F</b><span class="nm">${a.intern ? '<em>인턴</em>' : ''}${esc(a.name)}${queue}${sched}</span>`
            + `<span class="st">${esc(a.now.icon)} ${esc(clip(a.now.title, 24))}</span><time>${esc(lobbyTime(a, st))}</time>`
            + ctxBar(a.intern ? null : ctxOf(s)) + '</li>',
        });
      }
    }
  });
  // 나를 기다리는 직원이 맨 위, 나머지는 층 순서대로 (같으면 원래 순서: 직원 다음에 그 인턴)
  rows.sort((x, y) => x.rank - y.rank || x.floor - y.floor);
  return rows.map(r => r.html).join('') || '<li class="lb none">아직 아무도 출근하지 않았어요</li>';
}
