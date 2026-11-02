// 캐릭터 정보 카드에 들어갈 내용(HTML). 어디에 띄울지는 app.js가 정한다.
// 화면(DOM) 없이 글자만 만들어서 테스트할 수 있다.
import { esc, clip, resumeCommand } from './util.js';

// 기본 모드(normal)는 굳이 안 보여 준다
const MODE_NAMES = { plan: '계획 모드', acceptEdits: '편집 자동 허용', bypassPermissions: '모든 권한 허용', auto: '자동 모드' };

// a: 캐릭터 { intern, name, desc, now: { icon, title, time, sub } }
// s: 세션 { sid, info, color, stats, interns, main }
// ctx: ctxOf(s) 결과 (인턴은 null)
// live: 실제 세션을 보는 중(데모·다시 보기가 아님), pinned: 이 세션만 보는 중, win: 이어 하기 명령을 PowerShell 꼴로
export function cardHtml(a, s, { ctx = null, live = false, pinned = false, win = false } = {}) {
  const info = s.info;
  // 지금 하위 폴더에 있으면 그 폴더도 (📂 frontend), 워크트리면 그 이름 (🌿 fix-login)
  let sub = info.here && info.cwd && info.here.startsWith(info.cwd) ? info.here.slice(info.cwd.length).replace(/^[\\/]+/, '') : '';
  let tree = info.worktree || '';
  const wt = sub.match(/^\.claude[\\/]worktrees[\\/]([^\\/]+)[\\/]?(.*)$/);
  if (wt) { tree = wt[1]; sub = wt[2]; }
  const where = [info.project, (info.model || '').replace(/^claude-/, ''), info.branch && info.branch !== 'HEAD' ? '⎇ ' + info.branch : '', tree ? '🌿 ' + tree : '', sub ? '📂 ' + sub : ''].filter(Boolean).map(esc).join(' · ');
  const head = a.intern
    ? `<b><em>인턴</em> ${esc(a.name)}</b><small>${esc(a.desc || '')}${a.desc ? ' · ' : ''}${esc(s.main.name)}의 인턴</small>`
    : `<b>${esc(info.title || s.main.name)}</b><small>${where}</small>`;
  // PR, 비용(Claude Code가 남긴 API 요금 기준), 권한 모드
  const extras = [];
  // PR 주소는 http(s)만 링크로 (기록에 javascript: 같은 주소가 들어 있어도 누를 수 없게)
  if (!a.intern && info.pr && /^https?:\/\//i.test(info.pr.url || '')) extras.push(`<a href="${esc(info.pr.url)}" target="_blank" rel="noopener">🔗 PR #${esc(info.pr.number)}</a>`);
  if (!a.intern && info.cost) {
    const lines = info.cost.added || info.cost.removed ? ` · +${info.cost.added} −${info.cost.removed}줄` : '';
    extras.push(`<span title="Claude Code가 남긴 API 요금 기준이에요. 구독 요금제라면 실제로 낸 돈과 달라요">💵 $${info.cost.usd.toFixed(2)}${lines}</span>`);
  }
  if (!a.intern && info.mode && MODE_NAMES[info.mode]) extras.push(`🛡 ${MODE_NAMES[info.mode]}`);
  const extraRow = extras.length ? `<div class="card-extra">${extras.join('<i>·</i>')}</div>` : '';
  const q = !a.intern && info.queue && info.queue.length ? info.queue : null;
  const queueRow = q ? `<div class="card-queue"><b>📨 기다리는 내 메시지 ${q.length}개</b>${q.slice(0, 3).map(t => `<small>${esc(t)}</small>`).join('')}</div>` : '';
  const nums = a.intern ? '' : `<div class="card-nums">도구 ${s.stats.tools} · 실패 ${s.stats.errors} · 내 메시지 ${s.stats.prompts}${s.interns.size ? ` · 인턴 ${s.interns.size}명` : ''}</div>`;
  const ctxRow = ctx ? `<div class="card-ctx now-ctx ${ctx.level}" style="--p:${ctx.p}%"><i></i><b>컨텍스트 ${ctx.p}%</b><small>${esc(ctx.text)}</small></div>` : '';
  const acts = !a.intern && live
    ? `<div class="card-acts"><button type="button" data-act="replay" title="이 세션을 처음부터 빠르게 다시 봐요">⏪ 다시 보기</button>${pinned ? '' : '<button type="button" data-act="pin">📌 이 세션만 보기</button>'}`
      + `<button type="button" data-act="resume" title="${esc(resumeCommand(info.cwd, s.sid, win))}">📋 이어 하기 명령 복사</button></div>`
    : '';
  const now = a.now || {};
  return `<button class="card-x" type="button" data-act="close" aria-label="닫기">✕</button><div class="card-head" style="--wc:${esc(s.color)}">${head}</div>`
    + `<div class="card-now">${esc(now.icon)} ${esc(now.title)}${now.time ? ` <time>${esc(now.time)}</time>` : ''}${now.sub ? `<small>${esc(clip(now.sub, 120))}</small>` : ''}</div>`
    + ctxRow + nums + extraRow + queueRow + acts;
}
