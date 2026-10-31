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
export const secs = s => (s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초째` : `${s}초째`);
export function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return '방금';
  if (s < 3600) return `${Math.round(s / 60)}분 전`;
  if (s < 86400) return `${Math.round(s / 3600)}시간 전`;
  return `${Math.round(s / 86400)}일 전`;
}
