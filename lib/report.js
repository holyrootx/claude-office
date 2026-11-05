// 업무 일지를 글로 쓴다: 터미널용(journalText)과 마크다운(journalMarkdown, 슬랙·노션에 붙여 넣는 하루 보고용).
// j는 lib/sessions.js의 journal() 결과. 주간 일지(weekText·weekMarkdown)는 그날그날의 journal()을 모아서 쓴다.
'use strict';

// 1시간 0분이 아니라 1시간으로
const worked = ms => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`; };
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

// ───────────── 주간 업무 일지 ─────────────
// --journal 이번 주 / 지난 주 → 그 주 월요일부터의 날들 { from, to } (오늘이 0, 어제가 -1). 주가 아니면 null
// 이번 주는 월요일부터 오늘까지, 지난 주는 월요일부터 일요일까지
function parseWeek(v, now = new Date()) {
  const s = String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
  if (['이번 주', '이번주', '주간', 'week', 'this week'].includes(s)) return weekRange(0, now);
  if (['지난 주', '지난주', '저번 주', '저번주', 'last week'].includes(s)) return weekRange(-1, now);
  return null;
}
// week: 0 = 이번 주(월요일~오늘), -1 = 지난 주(월~일) …
function weekRange(week = 0, now = new Date()) {
  const from = -((now.getDay() + 6) % 7) + 7 * Math.min(0, week);
  return { from, to: week < 0 ? from + 6 : 0 };
}

const WEEKDAY = '일월화수목금토';
const md = ts => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAY[d.getDay()]})`; };
const weekTitle = days => {
  const a = new Date(days[0].since), b = new Date(days[days.length - 1].since);
  const f = d => `${d.getMonth() + 1}월 ${d.getDate()}일(${WEEKDAY[d.getDay()]})`;
  return `${f(a)}~${f(b)} 주간 업무 일지`;
};

// 날마다 일지를 한 주로 모은다: 합계, 일한 날, 프로젝트마다(세션은 일한 시간이 긴 순서로)
function weekSummary(days) {
  const NUMS = ['workedMs', 'prompts', 'scheduled', 'tools', 'errors', 'interns', 'tokens'];
  const totals = Object.fromEntries(NUMS.map(k => [k, 0]));
  const projects = new Map();
  for (const j of days) {
    for (const k of NUMS) totals[k] += (j.totals && j.totals[k]) || 0;
    for (const p of j.projects) {
      const key = p.cwd || p.project;
      if (!projects.has(key)) projects.set(key, { project: p.project, days: 0, sessions: new Map(), rooms: {}, ...Object.fromEntries(NUMS.map(k => [k, 0])) });
      const q = projects.get(key);
      q.days++;
      for (const k of NUMS) q[k] += p[k] || 0;
      for (const [r, n] of Object.entries(p.rooms || {})) q.rooms[r] = (q.rooms[r] || 0) + n;
      for (const s of p.sessions) {
        const t = q.sessions.get(s.id) || { title: s.title, file: s.file, workedMs: 0 };
        t.workedMs += s.workedMs;
        q.sessions.set(s.id, t);
      }
    }
  }
  const list = [...projects.values()].map(p => ({ ...p, sessions: [...p.sessions.values()].sort((a, b) => b.workedMs - a.workedMs) }))
    .sort((a, b) => b.workedMs - a.workedMs);
  return { totals, projects: list, worked: days.filter(j => j.projects.length).length };
}

const weekTotals = (w, n) => `일한 시간 ${worked(w.totals.workedMs)} · 일한 날 ${w.worked}/${n} · 내 메시지 ${w.totals.prompts}${w.totals.scheduled ? ` · 예약 작업 ${w.totals.scheduled}` : ''} · 도구 ${w.totals.tools} · 실패 ${w.totals.errors} · 출력 토큰 ${tok(w.totals.tokens)}`;
const weekProject = p => `${worked(p.workedMs)} · ${p.days}일 · ${projectNums(p)}`;

function weekText(days) {
  const w = weekSummary(days);
  const out = ['', `  📓 ${weekTitle(days)}`];
  if (!w.projects.length) return out.concat('  이번 주에는 일한 기록이 없어요', '').join('\n');
  out.push(`  ${weekTotals(w, days.length)}`, '', '  날마다');
  const max = Math.max(1, ...days.map(j => (j.totals && j.totals.workedMs) || 0));
  for (const j of days) {
    const ms = (j.totals && j.totals.workedMs) || 0;
    const bar = ms ? '█'.repeat(Math.max(1, Math.round((ms / max) * 12))) : '·';
    out.push(`    ${md(j.since).padEnd(10)} ${bar.padEnd(12)}  ${ms ? `${worked(ms)} · 도구 ${j.totals.tools}` : '-'}`);
  }
  out.push('', '  프로젝트마다');
  for (const p of w.projects) {
    out.push(`    ${p.project}  ${weekProject(p)}`);
    for (const s of p.sessions.slice(0, 5)) out.push(`      - ${s.title} (${worked(s.workedMs)})`);
    if (p.sessions.length > 5) out.push(`      - 그 밖에 세션 ${p.sessions.length - 5}개`);
  }
  out.push('');
  return out.join('\n');
}

function weekMarkdown(days) {
  const w = weekSummary(days);
  const out = [`## ${weekTitle(days)}`, ''];
  if (!w.projects.length) return out.concat('이번 주에는 일한 기록이 없어요', '').join('\n');
  out.push(weekTotals(w, days.length), '', '### 날마다');
  for (const j of days) {
    const ms = (j.totals && j.totals.workedMs) || 0;
    out.push(`- ${md(j.since)}: ${ms ? `${worked(ms)} · 도구 ${j.totals.tools}` : '쉼'}`);
  }
  out.push('');
  for (const p of w.projects) {
    out.push(`### ${p.project}`, weekProject(p), '');
    for (const s of p.sessions.slice(0, 5)) out.push(`- ${s.title} (${worked(s.workedMs)})`);
    if (p.sessions.length > 5) out.push(`- 그 밖에 세션 ${p.sessions.length - 5}개`);
    out.push('');
  }
  return out.join('\n');
}

module.exports = { journalText, journalMarkdown, parseDay, parseWeek, weekRange, weekTitle, weekSummary, weekText, weekMarkdown };
