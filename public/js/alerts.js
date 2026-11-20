// 알림과 탭 아이콘: 다른 창을 보고 있을 때 누가 나를 기다리면 브라우저 알림을 띄우고,
// 탭 아이콘에 기다리는 사람 수를 빨간 숫자로 단다.
import { $, clip } from './util.js';
import { NOTIFY_WHAT } from './help.js';

// 🔔 버튼으로 켜고 끄며 기본은 꺼져 있다.
// toast: 화면 가운데 짧은 안내, show(s, w): 알림을 누르면 그 층으로 가서 그 사람의 카드를 연다, quiet(): 데모·다시 보기처럼 알리면 안 될 때 true
export function createAlerts({ toast, show, quiet }) {
  const NOTIFY_KEY = 'claude-office-notify';
  let notifyOn = false;
  try { notifyOn = localStorage.getItem(NOTIFY_KEY) === '1'; } catch { /* 저장소 없음 */ }
  const canNotify = () => 'Notification' in window && Notification.permission === 'granted';
  // 세션마다 아직 떠 있는 기다림 알림: 터미널에서 허락·답을 하고 나면 닫는다 (전에는 '🔐 기다려요'가 알림 센터에 그대로 남았다)
  const waitNotes = new Map();

  // w: 권한·입력을 기다리는 알림이면 그 기다림 (인턴이 기다리면 그 인턴의 카드를 연다)
  function notify(s, title, body, w = null) {
    if (!notifyOn || !canNotify() || quiet()) return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return; // 이미 보고 있다
    // 같은 세션 알림은 tag로 하나만 남긴다
    let n;
    try {
      // renotify: 같은 tag로 바꿔 띄워도 다시 울리게 (없으면 Chrome은 앞 알림이 알림 센터에 남아 있을 때 소리·배너 없이
      // 내용만 바꿔서, 응답 완료 알림을 안 지운 사이 그 세션이 허락을 기다려도 모르고 지나갔다)
      n = new Notification(title, { body: `${s.main.name} · ${clip(body, 120)}`, tag: 'claude-office-' + s.sid, renotify: true, icon: faviconUrl(0) });
    } catch {
      // 안드로이드 Chrome처럼 허락은 받았어도 페이지가 바로 알림을 만들 수 없는 브라우저 (전에는 여기서 던진 오류에
      // 그 묶음의 장면이 통째로 빠져서 🔐 기다림·말풍선이 안 떴다). 알림을 끄고 버튼에 까닭을 남긴다
      notifyOn = false;
      try { localStorage.setItem(NOTIFY_KEY, '0'); } catch { /* 저장소 없음 */ }
      renderNotifyBtn('이 브라우저에서는 페이지가 알림을 띄울 수 없어서 알림을 껐어요');
      return;
    }
    n.onclick = () => {
      window.focus();
      show(s, w);
      n.close();
    };
    if (w) waitNotes.set(s.sid, n);
    else waitNotes.delete(s.sid); // 같은 tag라 앞 알림은 이미 바뀌었다
    n.onclose = () => { if (waitNotes.get(s.sid) === n) waitNotes.delete(s.sid); };
  }
  // 그 세션이 더는 기다리지 않을 때 (허락·답을 했거나 세션이 빌딩을 나갔을 때) 떠 있는 기다림 알림을 닫는다
  function waitDone(sid) {
    const n = waitNotes.get(sid);
    if (!n) return;
    waitNotes.delete(sid);
    try { n.close(); } catch { /* 이미 닫힘 */ }
  }
  function notifyWait(s, w) {
    const what = w.tool ? `${w.tool} ${w.label || ''}` : w.text || '';
    notify(s, w.kind === 'input' ? '🔐 입력을 기다려요' : '🔐 실행 허락을 기다려요', what, w);
  }

  async function toggleNotify() {
    // 화면에 보이는 상태를 뒤집는다 (예전에 켜 두었어도 지금 권한이 없으면 꺼진 것으로 보인다)
    const wasOn = $('notifyBtn').classList.contains('on');
    if (!('Notification' in window)) return renderNotifyBtn('이 브라우저는 알림을 지원하지 않아요');
    if (!wasOn && Notification.permission === 'default') {
      // 옛 Safari는 약속(Promise) 대신 콜백으로 답해서 둘 다 받는다
      try { await new Promise(done => { const p = Notification.requestPermission(done); if (p && p.then) p.then(done, done); }); } catch { /* 묻지 못함: 아래에서 '허락하지 않음'으로 */ }
    }
    if (Notification.permission === 'denied') {
      notifyOn = false;
      return renderNotifyBtn('브라우저 설정에서 이 페이지의 알림이 막혀 있어요');
    }
    // 허락 창을 그냥 닫았거나 브라우저가 조용히 넘겼으면 전에는 버튼이 🔕 그대로라 눌린 건지도 알 수 없었다
    if (!wasOn && Notification.permission === 'default') return renderNotifyBtn('알림을 허락하지 않아서 켜지 않았어요. 다시 누르면 또 물어봐요');
    notifyOn = !wasOn && canNotify();
    try { localStorage.setItem(NOTIFY_KEY, notifyOn ? '1' : '0'); } catch { /* 저장소 없음 */ }
    renderNotifyBtn();
    if (notifyOn) toast('🔔 다른 창을 볼 때 기다리는 일이 생기면 알려 드려요');
  }
  function renderNotifyBtn(why) {
    const b = $('notifyBtn');
    const on = notifyOn && canNotify();
    b.textContent = on ? '🔔' : '🔕';
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on)); // 화면 읽기 프로그램: '알림, 눌림/안 눌림'
    b.title = why || (on ? `알림 켜짐: 다른 창을 볼 때 ${NOTIFY_WHAT}을 알려요. 알림을 누르면 그 사람의 정보 카드가 열려요 (누르면 끔)` : '알림 꺼짐: 누르면 켜요');
    if (why) toast(why);
  }

  // 탭 아이콘: Claude 얼굴, 기다리는 사람이 있으면 빨간 숫자
  let faviconKey = -1;
  function faviconUrl(n) {
    const badge = n ? `<circle cx="48" cy="16" r="15" fill="#ef4444"/><text x="48" y="22" font-size="19" font-weight="700" text-anchor="middle" fill="#fff" font-family="sans-serif">${n > 9 ? '9+' : n}</text>` : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="8" y="12" width="46" height="44" rx="19" fill="#D97757"/><ellipse cx="24" cy="32" rx="3.4" ry="4.4" fill="#2b1d16"/><ellipse cx="38" cy="32" rx="3.4" ry="4.4" fill="#2b1d16"/><path d="M27 41 q4 4 8 0" stroke="#2b1d16" stroke-width="2.6" fill="none" stroke-linecap="round"/>${badge}</svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
  function setFavicon(n) {
    if (n === faviconKey) return;
    faviconKey = n;
    $('favicon').href = faviconUrl(n);
  }

  $('notifyBtn').addEventListener('click', toggleNotify);
  renderNotifyBtn();
  return { notify, notifyWait, waitDone, setFavicon };
}
