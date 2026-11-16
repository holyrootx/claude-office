// 캐릭터 정보 카드에 들어갈 내용(HTML). 어디에 띄울지는 app.js가 정한다.
// 화면(DOM) 없이 글자만 만들어서 테스트할 수 있다.
import { esc, clip, resumeCommand, secs, fmtWorked, modelName } from './util.js';

// 기본 모드(normal)는 굳이 안 보여 준다
const MODE_NAMES = { plan: '계획 모드', acceptEdits: '편집 자동 허용', bypassPermissions: '모든 권한 허용', auto: '자동 모드' };
// 설명이 붙은 글: 마우스를 올리면 title로, 누르면(폰처럼 마우스가 없어도) 화면 가운데 안내로 보여 준다 (app.js가 data-tip을 띄운다)
const tipBtn = (cls, tip, html) => `<button type="button" class="card-tip${cls ? ' ' + cls : ''}" data-tip="${esc(tip)}" title="${esc(tip)}">${html}</button>`;
// 마우스를 올리면 보이는 설명: 그 모드에서 무엇을 묻고 무엇을 안 묻는지
const MODE_HELP = {
  plan: '파일을 고치거나 명령을 실행하지 않고 계획만 세워요. 계획을 받아들이면 일을 시작해요',
  acceptEdits: '파일 편집은 묻지 않고 하고, 명령 실행 같은 다른 일은 물어봐요',
  auto: '안전하다고 판단한 일은 묻지 않고 하고, 위험해 보이는 일은 막거나 물어봐요',
  bypassPermissions: '아무것도 묻지 않고 다 해요. 믿을 수 있는 곳에서만 쓰세요',
};

// a: 캐릭터 { intern, name, desc, now: { icon, title, time, sub } }
// s: 세션 { sid, info, color, stats, interns, main }
// ctx: ctxOf(s) 결과 (인턴은 null)
// live: 실제 세션을 보는 중(데모·다시 보기가 아님), pinned: 이 세션만 보는 중, win: 이어 하기 명령을 PowerShell 꼴로
// today: 이 세션이 오늘 일한 시간(ms, 업무 일지와 같은 셈, 모르면 0), clock: 지금 시각 (테스트용)
// 세션을 언제 시작했는지 (info.started): 오늘이면 '09:12부터', 전이면 '10/24부터 · 23일째'
function sinceText(started, now) {
  if (!started) return '';
  const d = new Date(started), t = new Date(now);
  const p = n => String(n).padStart(2, '0');
  if (d.toDateString() === t.toDateString()) return `${p(d.getHours())}:${p(d.getMinutes())}부터`;
  const days = Math.round((new Date(t).setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000) + 1;
  return `${d.getMonth() + 1}/${d.getDate()}부터 · ${days}일째`;
}
// 인턴은 맡은 일을 얼마나 했는지: 쓴 도구 수와 일한 시간 (끝났으면 '3분 일했어요', 하는 중이면 '3분 20초째')
function internNums(a, now = Date.now()) {
  if (!a.firstTs) return '';
  const sec = Math.max(0, Math.round(((a.doneTs || now) - a.firstTs) / 1000));
  const time = a.doneTs ? `${sec >= 60 ? Math.round(sec / 60) + '분' : sec + '초'} 일했어요` : secs(sec);
  return `<div class="card-nums">도구 ${a.toolCount || 0}번 · ${time}</div>`;
}

export function cardHtml(a, s, { ctx = null, live = false, pinned = false, win = false, today = 0, clock = Date.now() } = {}) {
  const info = s.info;
  // 지금 하위 폴더에 있으면 그 폴더도 (📂 frontend), 워크트리면 그 이름 (🌿 fix-login)
  let sub = info.here && info.cwd && info.here.startsWith(info.cwd) ? info.here.slice(info.cwd.length).replace(/^[\\/]+/, '') : '';
  let tree = info.worktree || '';
  const wt = sub.match(/^\.claude[\\/]worktrees[\\/]([^\\/]+)[\\/]?(.*)$/);
  if (wt) { tree = wt[1]; sub = wt[2]; }
  const where = [info.project, modelName(info.model), info.branch && info.branch !== 'HEAD' ? '⎇ ' + info.branch : '', tree ? '🌿 ' + tree : '', sub ? '📂 ' + sub : ''].filter(Boolean).map(esc).join(' · ');
  const head = a.intern
    ? `<b><em>인턴</em> ${esc(a.name)}</b><small>${esc(a.desc || '')}${a.desc ? ' · ' : ''}${esc(s.main.name)}의 인턴</small>`
    : `<b>${esc(info.title || s.main.name)}</b><small>${where}</small>`;
  // PR, 비용(Claude Code가 남긴 API 요금 기준), 권한 모드
  const extras = [];
  // PR 주소는 http(s)만 링크로 (기록에 javascript: 같은 주소가 들어 있어도 누를 수 없게)
  if (!a.intern && info.pr && /^https?:\/\//i.test(info.pr.url || '')) extras.push(`<a href="${esc(info.pr.url)}" target="_blank" rel="noopener">🔗 PR #${esc(info.pr.number)}</a>`);
  if (!a.intern && info.cost) {
    const lines = info.cost.added || info.cost.removed ? ` · +${info.cost.added} −${info.cost.removed}줄` : '';
    extras.push(tipBtn('', 'Claude Code가 남긴 API 요금 기준이에요. 구독 요금제라면 실제로 낸 돈과 달라요', `💵 $${info.cost.usd.toFixed(2)}${lines}`));
  }
  if (!a.intern && info.mode && MODE_NAMES[info.mode]) {
    extras.push(tipBtn(`card-mode${info.mode === 'bypassPermissions' ? ' risky' : ''}`, MODE_HELP[info.mode], `${info.mode === 'bypassPermissions' ? '⚠' : '🛡'} ${MODE_NAMES[info.mode]}`));
  }
  const extraRow = extras.length ? `<div class="card-extra">${extras.join('<i>·</i>')}</div>` : '';
  const q = !a.intern && info.queue && info.queue.length ? info.queue : null;
  const queueRow = q ? `<div class="card-queue"><b>📨 기다리는 메시지 ${q.length}개</b>${q.slice(0, 3).map(t => `<small>${esc(t)}</small>`).join('')}</div>` : '';
  const nums = a.intern ? internNums(a) : `<div class="card-nums">도구 ${s.stats.tools} · ${s.stats.errors ? `<button type="button" class="card-fails" data-act="fails" title="활동 기록에서 실패만 모아 봐요">실패 ${s.stats.errors}</button>` : '실패 0'} · 내 메시지 ${s.stats.prompts}${s.interns.size ? ` · 인턴 ${s.interns.size}명` : ''}${today >= 60000 ? ` · 오늘 ${fmtWorked(today)}` : ''}${info.started ? ` · ${sinceText(info.started, clock)}` : ''}</div>`;
  const ctxRow = ctx ? `<div class="card-ctx now-ctx ${ctx.level}" style="--p:${ctx.p}%"><i></i><b>컨텍스트 ${ctx.p}%</b><small>${esc(ctx.text)}</small></div>` : '';
  const multiDay = !a.intern && info.started && info.started < new Date(clock).setHours(0, 0, 0, 0);
  const acts = !a.intern && live
    ? `<div class="card-acts"><button type="button" data-act="replay" title="이 세션을 처음부터 빠르게 다시 봐요">⏪ 다시 보기</button>`
      // 며칠째 이어지는 세션이면 오늘 한 일만 보기 (처음부터면 지난 며칠을 한참 넘겨야 해서)
      + (multiDay ? '<button type="button" data-act="replay-today" title="오늘 0시부터 빠르게 다시 봐요">⏪ 오늘부터</button>' : '')
      + `${pinned ? '' : '<button type="button" data-act="pin">📌 이 세션만 보기</button>'}`
      + `<button type="button" data-act="resume" title="${esc(resumeCommand(info.cwd, s.sid, win))}">📋 이어 하기 명령 복사</button></div>`
    : '';
  const now = a.now || {};
  return `<button class="card-x" type="button" data-act="close" aria-label="닫기">✕</button><div class="card-head" style="--wc:${esc(s.color)}">${head}</div>`
    + `<div class="card-now">${esc(now.icon)} ${esc(now.title)}${now.time ? ` <time>${esc(now.time)}</time>` : ''}${now.sub ? `<small>${esc(clip(now.sub, 120))}</small>` : ''}</div>`
    + ctxRow + nums + extraRow + queueRow + acts;
}
