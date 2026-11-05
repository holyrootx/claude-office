// 업무 일지를 글로 쓴다: 터미널용(journalText)과 마크다운(journalMarkdown, 슬랙·노션에 붙여 넣는 하루 보고용).
// j는 lib/sessions.js의 journal() 결과.
'use strict';

const worked = ms => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`; };
const hm = ts => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const tok = n => (n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')}만` : Number(n || 0).toLocaleString()); // 화면과 같은 꼴 (12.3만)
const ICONS = { library: '📚', dev: '💻', server: '🖥️', search: '🌐', meeting: '🗂️', desk: '🙋' };

const dayTitle = j => { const d = new Date(j.since); return `${d.getMonth() + 1}월 ${d.getDate()}일 업무 일지`; };
const empty = j => (j.today ? '오늘은 아직 일한 기록이 없어요' : '이날은 일한 기록이 없어요');
const totalsLine = t => `일한 시간 ${worked(t.workedMs)} · 프로젝트 ${t.projects} · 세션 ${t.sessions} · 내 메시지 ${t.prompts}${t.scheduled ? ` · 예약 작업 ${t.scheduled}` : ''} · 도구 ${t.tools} · 실패 ${t.errors} · 인턴 ${t.interns} · 출력 토큰 ${tok(t.tokens)}`;
const projectNums = p => `메시지 ${p.prompts}${p.scheduled ? ` · 예약 작업 ${p.scheduled}` : ''} · 도구 ${p.tools}${p.errors ? ` · 실패 ${p.errors}` : ''}${p.interns ? ` · 인턴 ${p.interns}명` : ''}${p.tokens ? ` · 출력 토큰 ${tok(p.tokens)}` : ''}`;

// 시간대별 도구 사용을 막대 글자로 (· 는 그 시간에 한 일이 없다는 뜻)
function hourBars(hours) {
  const max = Math.max(1, ...hours);
  const bars = hours.map(n => (n ? '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor((n / max) * 7.999))] : '·')).join('');
  const axis = Array(24).fill(' ');
  for (const h of [0, 6, 12, 18]) String(h).split('').forEach((c, i) => { axis[h + i] = c; });
  return [bars, axis.join('').trimEnd() + '시'];
}

// --journal 뒤에 적은 날 → journal()이 받는 꼴(0, -1, 'YYYY-MM-DD'). 모르는 말이면 null.
// 오늘·어제·그저께(그제), -3·3일 전, 10/31·10.31·10월 31일(올해, 아직 안 온 날이면 작년), 2026-10-31
function parseDay(v, now = new Date()) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s || s === '오늘' || s === 'today') return 0;
  if (s === '어제' || s === 'yesterday') return -1;
  if (s === '그저께' || s === '그제') return -2;
  let m;
  if ((m = /^-(\d+)$/.exec(s)) || (m = /^(\d+)\s*일\s*전$/.exec(s))) return -Number(m[1]);
  const ymd = (y, mo, d) => {
    const t = new Date(y, mo - 1, d);
    if (t.getFullYear() !== y || t.getMonth() !== mo - 1 || t.getDate() !== d) return null; // 13월 45일 같은 날
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return ymd(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})\s*[/.]\s*(\d{1,2})$/.exec(s)) || (m = /^(\d{1,2})\s*월\s*(\d{1,2})\s*일?$/.exec(s))) {
    const y = now.getFullYear();
    const later = new Date(y, +m[1] - 1, +m[2]) > now;
    return ymd(later ? y - 1 : y, +m[1], +m[2]);
  }
  return null;
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

module.exports = { journalText, journalMarkdown, parseDay };
