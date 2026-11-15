// 업무 일지 창에 들어갈 내용(HTML). 화면(DOM) 없이 글자만 만들어서 테스트할 수 있게 journal.js에서 떼어 냈다.
// 하루·한 주·한 달마다 { title, totals, hours, list, since, nextDisabled }를 돌려준다.
//   hours: { html, week(요일·주 막대인지), n(막대 칸 수), label, hidden }
//   since: 이 창에서 세션을 누르면 여기부터 다시 본다 (그날·그 주 월요일·그 달 1일의 0시)
import { esc, clip, hhmmss, fmtTokens, fmtWorked, weekOffset } from './util.js';
import { ROOMS, ROOM_IDS } from './scene.js';

const WEEKDAY = '일월화수목금토';

const totalsHtml = list => list.map(([k, v]) => `<div><b>${esc(v)}</b><span>${k}</span></div>`).join('');
const roomsHtml = rooms => {
  const max = Math.max(1, ...ROOM_IDS.map(r => rooms[r] || 0));
  return ROOM_IDS.map(r => `<span style="--c:var(--${r});--w:${Math.round(((rooms[r] || 0) / max) * 100)}%" title="${ROOMS[r].name} ${rooms[r] || 0}번">${ROOMS[r].icon}<i></i><b>${rooms[r] || 0}</b></span>`).join('');
};
const numsHtml = p => `<div class="jp-nums">메시지 ${p.prompts}${p.scheduled ? ` · 예약 작업 ${p.scheduled}` : ''} · 도구 ${p.tools}${p.errors ? ` · 실패 ${p.errors}` : ''}${p.interns ? ` · 인턴 ${p.interns}명` : ''}${p.tokens ? ` · 출력 토큰 ${fmtTokens(p.tokens)}` : ''}</div>`;
const sessionLi = s => `<li data-file="${esc(s.file)}" tabindex="0" role="button" title="누르면 지금 보는 날·주·달의 처음부터 다시 봐요"><span>⏪ ${esc(clip(s.title, 44))}</span><time>${fmtWorked(s.workedMs)}</time></li>`;
// 프로젝트 이름 옆 '이 프로젝트만' (둘 이상이고 아직 안 골랐을 때), 골랐으면 제목 옆 '✕ blog만'으로 풀기
const onlyBtn = (p, many, project) => (many && !project ? ` <button type="button" class="jp-only" data-project="${esc(p.project)}" title="이 프로젝트만 모아 봐요 (📋 복사도 이 프로젝트만)">이 프로젝트만</button>` : '');
const clearBtn = project => (project ? `<button type="button" class="jp-clear" title="모든 프로젝트 다시 보기">✕ ${esc(project)}만</button>` : '');
const midnight = t => new Date(t).setHours(0, 0, 0, 0);

// 하루: 합계, 시간대 막대 24개(오늘이면 지금 시각은 진하게), 프로젝트마다 시간·방별 사용량·세션
export function dayView(j, { day = 0, project = '', now = Date.now() } = {}) {
  const d = new Date(j.since);
  const rel = j.today ? '오늘' : day === -1 ? '어제' : `${-day}일 전`;
  const t = j.totals || {};
  const hours = j.hours || [];
  const maxH = Math.max(1, ...hours);
  const nowH = j.today ? new Date(now).getHours() : -1;
  const many = j.projects.length > 1;
  return {
    since: j.since,
    nextDisabled: !!j.today,
    title: `📓 ${d.getMonth() + 1}월 ${d.getDate()}일 업무 일지${project ? ` · ${esc(project)}` : ''}<small>${rel}</small>${clearBtn(project)}`,
    totals: totalsHtml([
      ['일한 시간', fmtWorked(t.workedMs)], ['프로젝트', t.projects], ['세션', t.sessions],
      ['내 메시지', t.prompts], ...(t.scheduled ? [['예약 작업', t.scheduled]] : []), ['도구', t.tools], ['실패', t.errors], ['인턴', t.interns], ['출력 토큰', fmtTokens(t.tokens || 0)],
    ]),
    hours: {
      week: false, n: 24, label: '시간대별 도구 사용', hidden: !hours.some(Boolean),
      html: hours.map((n, h) => `<i class="${h === nowH ? 'now' : ''}" style="--h:${Math.round((n / maxH) * 100)}%" title="${h}시 · 도구 ${n}번"></i>`).join('')
        + [0, 6, 12, 18].map(h => `<span style="--c:${h + 1}">${h}시</span>`).join(''),
    },
    list: j.projects.length ? j.projects.map(p =>
      `<section class="jp"><h3>${esc(p.project)} <small>${hhmmss(p.first).slice(0, 5)} ~ ${hhmmss(p.last).slice(0, 5)} · ${fmtWorked(p.workedMs)}</small>${onlyBtn(p, many, project)}</h3>`
        + numsHtml(p) + `<div class="jp-rooms">${roomsHtml(p.rooms)}</div><ul>${p.sessions.map(sessionLi).join('')}</ul></section>`).join('')
      : `<p class="jp-empty">${project ? `'${esc(project)}'에서 ` : ''}${j.today ? '오늘은 아직 일한 기록이 없어요' : '이날은 일한 기록이 없어요'}</p>`,
  };
}

// 한 주·한 달의 합계와 프로젝트 목록 (프로젝트는 여러 날을 합쳐서, 세션은 긴 순서로 8개까지)
const rangeTotals = (j, days) => {
  const t = j.totals || {};
  return totalsHtml([
    ['일한 시간', fmtWorked(t.workedMs)], ['일한 날', `${j.worked}/${days}`], ['프로젝트', j.projects.length],
    ['내 메시지', t.prompts], ...(t.scheduled ? [['예약 작업', t.scheduled]] : []), ['도구', t.tools], ['실패', t.errors], ['출력 토큰', fmtTokens(t.tokens || 0)],
  ]);
};
const rangeProjects = (j, empty, project) => (j.projects.length ? j.projects.map(p => {
  const more = p.sessions.length > 8 ? `<li class="more">그 밖에 세션 ${p.sessions.length - 8}개</li>` : '';
  return `<section class="jp"><h3>${esc(p.project)} <small>${p.days}일 · ${fmtWorked(p.workedMs)}</small>${onlyBtn(p, j.projects.length > 1, project)}</h3>`
    + numsHtml(p) + `<div class="jp-rooms">${roomsHtml(p.rooms)}</div><ul>${p.sessions.slice(0, 8).map(sessionLi).join('')}${more}</ul></section>`;
}).join('') : `<p class="jp-empty">${empty}</p>`);

// 한 주: 요일 막대 (누르면 그날 일지로: data-day는 오늘이 0, 어제가 -1)
export function weekView(j, { week = 0, project = '', now = Date.now() } = {}) {
  const rel = j.today ? '이번 주' : week === -1 ? '지난 주' : `${-week}주 전`;
  const today = midnight(now);
  const maxD = Math.max(1, ...j.days.map(d => d.workedMs));
  const label = d => { const x = new Date(d.since); return `${x.getMonth() + 1}/${x.getDate()} (${WEEKDAY[x.getDay()]})`; };
  const off = d => Math.round((d.since - today) / 86400000);
  return {
    since: (j.days[0] && j.days[0].since) || 0,
    nextDisabled: !!j.today,
    title: `📓 ${esc(j.title)}<small>${rel}</small>${clearBtn(project)}`,
    totals: rangeTotals(j, j.days.length),
    hours: {
      week: true, n: 7, label: '날마다 일한 시간', hidden: false,
      html: j.days.map(d => `<i class="${d.since === today ? 'now' : ''}" data-day="${off(d)}" style="--h:${Math.round((d.workedMs / maxD) * 100)}%" title="${label(d)} · ${d.workedMs ? `${fmtWorked(d.workedMs)} · 도구 ${d.tools}번` : '쉼'} · 누르면 그날 일지"></i>`).join('')
        + j.days.map((d, i) => `<span style="--c:${i + 1}" data-day="${off(d)}" role="button" tabindex="0" aria-label="${label(d)} 일지 보기"><b>${WEEKDAY[new Date(d.since).getDay()]}</b>${d.workedMs ? fmtWorked(d.workedMs) : '·'}</span>`).join(''),
    },
    list: rangeProjects(j, j.today ? '이번 주에는 아직 일한 기록이 없어요' : '이 주에는 일한 기록이 없어요', project),
  };
}

// 한 달: 주마다(월요일부터) 막대 (누르면 그 주 일지로: data-week는 이번 주가 0)
export function monthView(j, { month = 0, project = '', now = Date.now() } = {}) {
  const rel = j.today ? '이번 달' : month === -1 ? '지난 달' : `${-month}달 전`;
  const weekOff = w => weekOffset(w.from, now);
  const span = w => { const a = new Date(w.from), b = new Date(w.to); return `${a.getMonth() + 1}/${a.getDate()}${w.to > w.from ? `~${b.getMonth() + 1}/${b.getDate()}` : ''}`; };
  const maxW = Math.max(1, ...j.weeks.map(w => w.workedMs));
  return {
    since: (j.weeks[0] && j.weeks[0].from) || 0,
    nextDisabled: !!j.today,
    title: `📓 ${esc(j.title)}<small>${rel}</small>${clearBtn(project)}`,
    totals: rangeTotals(j, j.days),
    hours: {
      week: true, n: j.weeks.length, label: '주마다 일한 시간', hidden: false,
      html: j.weeks.map(w => `<i class="${weekOff(w) === 0 ? 'now' : ''}" data-week="${weekOff(w)}" style="--h:${Math.round((w.workedMs / maxW) * 100)}%" title="${span(w)} · ${w.workedMs ? `${fmtWorked(w.workedMs)} · ${w.worked}일 · 도구 ${w.tools}번` : '쉼'} · 누르면 그 주 일지"></i>`).join('')
        // 좁은 칸에서는 '10/5~' 다음에서 줄을 바꿀 수 있게 (<wbr>, 안 그러면 막대가 옆으로 넘친다)
        + j.weeks.map((w, i) => `<span style="--c:${i + 1}" data-week="${weekOff(w)}" role="button" tabindex="0" aria-label="${span(w)} 주간 일지 보기"><b>${span(w).replace('~', '~<wbr>')}</b>${w.workedMs ? fmtWorked(w.workedMs) : '·'}</span>`).join(''),
    },
    list: rangeProjects(j, j.today ? '이번 달에는 아직 일한 기록이 없어요' : '이 달에는 일한 기록이 없어요', project),
  };
}
