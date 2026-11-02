// 업무 일지를 글로 쓴다: 터미널용(journalText)과 마크다운(journalMarkdown, 슬랙·노션에 붙여 넣는 하루 보고용).
// j는 lib/sessions.js의 journal() 결과.
'use strict';

const worked = ms => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`; };
const hm = ts => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const tok = n => (n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')}만` : Number(n || 0).toLocaleString()); // 화면과 같은 꼴 (12.3만)
const ICONS = { library: '📚', dev: '💻', server: '🖥️', search: '🌐', meeting: '🗂️', desk: '🙋' };

const dayTitle = j => { const d = new Date(j.since); return `${d.getMonth() + 1}월 ${d.getDate()}일 업무 일지`; };
const empty = j => (j.today ? '오늘은 아직 일한 기록이 없어요' : '이날은 일한 기록이 없어요');
const totalsLine = t => `일한 시간 ${worked(t.workedMs)} · 프로젝트 ${t.projects} · 세션 ${t.sessions} · 내 메시지 ${t.prompts} · 도구 ${t.tools} · 실패 ${t.errors} · 인턴 ${t.interns} · 출력 토큰 ${tok(t.tokens)}`;
const projectNums = p => `메시지 ${p.prompts} · 도구 ${p.tools}${p.errors ? ` · 실패 ${p.errors}` : ''}${p.interns ? ` · 인턴 ${p.interns}명` : ''}${p.tokens ? ` · 출력 토큰 ${tok(p.tokens)}` : ''}`;

// 시간대별 도구 사용을 막대 글자로 (· 는 그 시간에 한 일이 없다는 뜻)
function hourBars(hours) {
  const max = Math.max(1, ...hours);
  const bars = hours.map(n => (n ? '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor((n / max) * 7.999))] : '·')).join('');
  const axis = Array(24).fill(' ');
  for (const h of [0, 6, 12, 18]) String(h).split('').forEach((c, i) => { axis[h + i] = c; });
  return [bars, axis.join('').trimEnd() + '시'];
}

function journalText(j) {
  const out = ['', `  📓 ${dayTitle(j)}`];
  if (!j.projects.length) return out.concat(`  ${empty(j)}`, '').join('\n');
  const [bars, axis] = hourBars(j.hours);
  out.push(`  ${totalsLine(j.totals)}`, '', `  시간대  ${bars}`, `          ${axis}`, '');
  for (const p of j.projects) {
    out.push(`  ${p.project}  ${hm(p.first)}~${hm(p.last)} · ${worked(p.workedMs)}`, `    ${projectNums(p)}`);
    out.push('    ' + Object.entries(ICONS).map(([r, i]) => `${i} ${p.rooms[r]}`).join('  '));
    for (const s of p.sessions) out.push(`    - ${s.title} (${worked(s.workedMs)})`);
    out.push('');
  }
  out.push('  (일한 시간은 기록 사이 간격이 5분보다 짧은 것만 더해요. 인턴 기록도 같이 봐요)', '');
  return out.join('\n');
}

function journalMarkdown(j) {
  const out = [`## ${dayTitle(j)}`, ''];
  if (!j.projects.length) return out.concat(empty(j), '').join('\n');
  out.push(totalsLine(j.totals), '');
  for (const p of j.projects) {
    out.push(`### ${p.project}`, `${hm(p.first)}~${hm(p.last)} · ${worked(p.workedMs)} · ${projectNums(p)}`, '');
    for (const s of p.sessions) out.push(`- ${s.title} (${worked(s.workedMs)})`);
    out.push('');
  }
  return out.join('\n');
}

module.exports = { journalText, journalMarkdown };
