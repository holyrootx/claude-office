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
// 예약해 둔 작업은 같은 긴 지시가 회차마다 반복되니 이름만: 'claude-office 자동 개선 1회: (1) …' → 'claude-office 자동 개선 1회'
// (앞쪽 40자 안에 ':'가 없으면 60자로 자른다. 활동 기록·말풍선·다시 보기 눈금이 같이 쓴다)
export function scheduleName(text) {
  const t = String(text || '');
  const i = t.search(/[:：]\s/);
  return i > 0 && i <= 40 ? t.slice(0, i) : clip(t, 60);
}

// ts가 든 주가 이번 주(now가 든 주, 월요일부터)에서 몇 주 떨어졌는지: 이번 주 0, 지난 주 -1 …
export function weekOffset(ts, now = Date.now()) {
  const monday = t => { const d = new Date(t); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); d.setHours(0, 0, 0, 0); return d.getTime(); };
  return Math.round((monday(ts) - monday(now)) / (7 * 86400000));
}

// 이번 차례를 예약해 둔 작업(크론·/loop)이 시켰는지: ⏰ 예약된 작업으로 시작하면 true, 내 말로 시작하거나 답을 마치면 false.
// 인턴의 일은 보지 않는다. 예약 작업이 시킨 차례가 끝날 때는 브라우저 알림을 띄우지 않으려고 쓴다
export function scheduledAfter(prev, ev) {
  if (!ev || ev.agent) return prev;
  if (ev.k === 'note' && ev.kind === 'schedule') return true;
  if (ev.k === 'user' || (ev.k === 'say' && ev.final)) return false;
  return prev;
}

// 같은 값을 다시 쓰지 않는다: 화면은 1초에 네 번 다시 그리는데, 같은 글·같은 숨김을 다시 쓰면
// 바뀐 게 없어도 브라우저가 스타일을 다시 계산해서 가만히 있을 때도 CPU를 쓴다
export const setText = (el, v) => { v = String(v); if (el.textContent !== v) el.textContent = v; };
export const setHidden = (el, h) => { if (el.hidden !== !!h) el.hidden = !!h; };
export const setAttr = (el, k, v) => { v = String(v); if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
export const setStyle = (el, k, v) => { if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v); };

// 창(업무 일지·도움말)이 떠 있는 동안 Tab이 창 밖(뒤의 사무실 화면)으로 빠져나가지 않게 한다.
// 마지막 버튼에서 Tab이면 처음으로, 처음에서 Shift+Tab이면 마지막으로. 초점이 창 밖에 있으면 창 안으로 데려온다.
const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';
export function trapTab(box, e) {
  if (e.key !== 'Tab' || !box) return false;
  const list = [...box.querySelectorAll(FOCUSABLE)].filter(el => el.getClientRects().length); // 숨긴 것은 빼고
  if (!list.length) return false;
  const first = list[0], last = list[list.length - 1];
  const at = document.activeElement;
  const out = !box.contains(at);
  if (e.shiftKey ? out || at === first : out || at === last) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
    return true;
  }
  return false;
}

// 화면 가운데 짧은 안내를 얼마나 띄울지: 글이 길수록 오래 (읽을 틈을 주게), 1.4초~4초
export const toastMs = text => Math.min(4000, Math.max(1400, 600 + String(text || '').length * 70));

// 일한 시간: '45분', '1시간', '3시간 34분'. 조금이라도 일했는데 반올림해서 0분이면 '1분 미만' (lib/report.js와 같은 꼴)
export const fmtWorked = ms => {
  const m = Math.round((ms || 0) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : !m && ms > 0 ? '1분 미만' : `${m}분`;
};
export const secs = s => (s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초째` : `${s}초째`);
// 얼마나 지났는지: '방금', '12분 전', '3시간 전', '2일 전'
// 반올림한 뒤에 단위를 고른다 (59분 40초가 '60분 전', 23시간 50분이 '24시간 전'으로 나오지 않게)
export function ago(ms, now = Date.now()) {
  const s = Math.round((now - ms) / 1000);
  if (s < 45) return '방금';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.round(s / 3600);
  if (h < 24) return `${h}시간 전`;
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

