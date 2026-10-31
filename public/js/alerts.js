// 알림과 탭 아이콘: 다른 창을 보고 있을 때 누가 나를 기다리면 브라우저 알림을 띄우고,
// 탭 아이콘에 기다리는 사람 수를 빨간 숫자로 단다.
import { $, clip } from './util.js';

// 🔔 버튼으로 켜고 끄며 기본은 꺼져 있다.
// toast: 화면 가운데 짧은 안내, goFloor: 알림을 누르면 그 층으로, quiet(): 데모·다시 보기처럼 알리면 안 될 때 true
export function createAlerts({ toast, goFloor, quiet }) {
  const NOTIFY_KEY = 'claude-office-notify';
  let notifyOn = false;
  try { notifyOn = localStorage.getItem(NOTIFY_KEY) === '1'; } catch { /* 저장소 없음 */ }
  const canNotify = () => 'Notification' in window && Notification.permission === 'granted';

  function notify(s, title, body) {
    if (!notifyOn || !canNotify() || quiet()) return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return; // 이미 보고 있다
    const floor = s.floor;
    // 같은 세션 알림은 tag로 하나만 남긴다
    const n = new Notification(title, { body: `${s.main.name} · ${clip(body, 120)}`, tag: 'claude-office-' + s.sid, icon: faviconUrl(0) });
    n.onclick = () => {
      window.focus();
      goFloor(floor);
      n.close();
    };
  }
  function notifyWait(s, w) {
    const what = w.tool ? `${w.tool} ${w.label || ''}` : w.text || '';
    notify(s, w.kind === 'input' ? '🔐 입력을 기다려요' : '🔐 실행 허락을 기다려요', what);
  }

  async function toggleNotify() {
    // 화면에 보이는 상태를 뒤집는다 (예전에 켜 두었어도 지금 권한이 없으면 꺼진 것으로 보인다)
    const wasOn = $('notifyBtn').classList.contains('on');
    if (!('Notification' in window)) return renderNotifyBtn('이 브라우저는 알림을 지원하지 않아요');
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission === 'denied') {
      notifyOn = false;
      return renderNotifyBtn('브라우저 설정에서 이 페이지의 알림이 막혀 있어요');
    }
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
    b.title = why || (on ? '알림 켜짐: 다른 창을 볼 때 권한 대기·질문·응답 완료를 알려요 (누르면 끔)' : '알림 꺼짐: 누르면 켜요');
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
  return { notify, notifyWait, setFavicon };
}
