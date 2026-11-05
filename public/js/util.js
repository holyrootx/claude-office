// 여러 모듈이 같이 쓰는 작은 도구들
export const $ = id => document.getElementById(id);
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const clip = (s, n) => (s = String(s || ''), s.length > n ? s.slice(0, n - 1) + '…' : s);
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const hhmmss = ts => {
  const d = new Date(ts), p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
// 날짜가 바뀌는 기록(다시 보기)에서는 '11/2 14:16'처럼 날짜를 붙인다
export const stamp = (ts, withDate) => {
  if (!withDate) return hhmmss(ts);
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmmss(ts).slice(0, 5)}`;
};
// 548123 → '54.8만'
export const fmtTokens = n => (n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')}만` : Number(n || 0).toLocaleString());
// 대화 압축을 어떻게 했는지: '자동 · 57초 걸림', '내가 요청 · 1분 3초 걸림', '쉬는 동안 미리 써 둔 요약'
export function compactHow(ev) {
  if (ev.idle) return '쉬는 동안 미리 써 둔 요약';
  const s = Math.round((ev.ms || 0) / 1000);
  const took = s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`;
  return `${ev.trigger === 'manual' ? '내가 요청' : '자동'}${s ? ` · ${took} 걸림` : ''}`;
}
// 일한 시간: '45분', '1시간', '3시간 34분'
export const fmtWorked = ms => {
  const m = Math.round((ms || 0) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`;
};
export const secs = s => (s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초째` : `${s}초째`);
export function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return '방금';
  if (s < 3600) return `${Math.round(s / 60)}분 전`;
  if (s < 86400) return `${Math.round(s / 3600)}시간 전`;
  return `${Math.round(s / 86400)}일 전`;
}

// 터미널에서 이 세션을 이어서 하는 명령: 그 폴더로 가서 claude --resume <세션 id>
// win이면 PowerShell 꼴 (cd "C:\x"; …), 아니면 sh 꼴 (cd '/x' && …)
export function resumeCommand(cwd, sid, win) {
  const resume = `claude --resume ${sid}`;
  if (!cwd) return resume;
  return win ? `cd "${cwd}"; ${resume}` : `cd '${String(cwd).replace(/'/g, `'\\''`)}' && ${resume}`;
}

// 컨텍스트가 얼마나 찼는지 (초록 → 노랑 60% → 빨강 85%). 세션 정보에 ctx가 없으면 null
// 사무실 프로그램이 바뀌었을 때 화면 위에 띄울 안내. code: 서버의 { restart, ui }, firstUi: 이 화면을 열 때의 ui 값
// → { kind: 'restart'|'reload'|'', text }
export function codeNotice(code, firstUi) {
  if (!code) return { kind: '', text: '' };
  if (code.restart) return { kind: 'restart', text: '🔄 사무실 프로그램이 바뀌었어요. 사무실을 끄고 다시 켜야 다 적용돼요 (켠 터미널에서 Ctrl+C 뒤 다시 실행, 플러그인이면 /office:stop 뒤 /office:open)' };
  if (firstUi && code.ui && code.ui !== firstUi) return { kind: 'reload', text: '🔄 화면이 새로 바뀌었어요. 새로 고치면 적용돼요' };
  return { kind: '', text: '' };
}

export function ctxOf(s) {
  const c = s && s.info && s.info.ctx;
  if (!c || !c.tokens) return null;
  const p = Math.min(100, Math.round((c.tokens / c.window) * 100));
  return { p, level: p >= 85 ? 'high' : p >= 60 ? 'mid' : 'low', text: `${fmtTokens(c.tokens)} / ${fmtTokens(c.window)} 토큰` };
}

