// 브라우저 알림(public/js/alerts.js): 알림 하나를 못 띄워도 화면이 멈추지 않고, 🔕를 눌렀는데 켜지지 않으면 까닭을 알려 준다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// 알림 버튼 하나와 알림 API만 흉내 낸다
function browser({ permission = 'granted', ask = 'granted', make } = {}) {
  const btn = { textContent: '', title: '', attrs: {}, on: false, click: null };
  btn.classList = { contains: c => c === 'on' && btn.on, toggle: (c, v) => { if (c === 'on') btn.on = !!v; } };
  btn.setAttribute = (k, v) => { btn.attrs[k] = v; };
  btn.addEventListener = (type, fn) => { if (type === 'click') btn.click = fn; };
  const store = new Map();
  const made = [];
  class Notification {
    constructor(title, opts) {
      if (make) make();
      this.rec = { title, ...opts, closed: false };
      made.push(this.rec);
    }
    close() {
      this.rec.closed = true;
      if (this.onclose) this.onclose();
    }
  }
  Notification.permission = permission;
  Notification.requestPermission = () => { Notification.permission = ask; return Promise.resolve(ask); };
  globalThis.window = { Notification, focus() {} };
  globalThis.Notification = Notification;
  const fav = { href: '' };
  globalThis.document = { getElementById: id => (id === 'notifyBtn' ? btn : fav), visibilityState: 'hidden', hasFocus: () => false };
  globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  return { btn, store, made, fav };
}

let createAlerts;
test.before(async () => {
  browser();
  ({ createAlerts } = await import('../public/js/alerts.js'));
});
test.after(() => { for (const k of ['window', 'Notification', 'document', 'localStorage']) delete globalThis[k]; });

const s = { sid: 'sid-1', main: { name: '로그인 고치기' } };

test('켜 두면 다른 창을 볼 때 알림을 띄운다', async () => {
  const { btn, made } = browser();
  const toasts = [];
  const al = createAlerts({ toast: t => toasts.push(t), show() {}, quiet: () => false });
  await btn.click();
  assert.equal(btn.textContent, '🔔');
  al.notifyWait(s, { kind: 'permission', tool: 'Bash', label: 'npm test' });
  assert.deepEqual(made.map(n => [n.title, n.body]), [['🔐 실행 허락을 기다려요', '로그인 고치기 · Bash npm test']]);
});

test('페이지가 알림을 만들 수 없는 브라우저(안드로이드 Chrome)면 오류를 던지지 않고 알림을 끈 뒤 까닭을 알린다', () => {
  const { btn, store } = browser({ make: () => { throw new TypeError("Failed to construct 'Notification': Illegal constructor."); } });
  store.set('claude-office-notify', '1'); // 전에 켜 두었다
  const toasts = [];
  const al = createAlerts({ toast: t => toasts.push(t), show() {}, quiet: () => false });
  assert.equal(btn.textContent, '🔔');
  // 전에는 이 오류가 받은 장면 묶음을 처리하던 곳까지 올라가서 그 뒤 장면(🔐 기다림 등)이 모두 빠졌다
  assert.doesNotThrow(() => al.notify(s, '✅ 응답 완료', '다 했어요'));
  assert.equal(btn.textContent, '🔕');
  assert.equal(store.get('claude-office-notify'), '0');
  assert.match(toasts.join('\n'), /알림을 띄울 수 없어서 알림을 껐어요/);
  assert.doesNotThrow(() => al.notify(s, '✅ 응답 완료', '또')); // 꺼졌으니 다시 만들지도 않는다
  assert.equal(toasts.length, 1);
});

test('🔕를 눌렀는데 허락 창을 그냥 닫으면 켜지지 않은 까닭을 알려 준다 (전에는 아무 말 없이 🔕 그대로)', async () => {
  const { btn } = browser({ permission: 'default', ask: 'default' });
  const toasts = [];
  createAlerts({ toast: t => toasts.push(t), show() {}, quiet: () => false });
  await btn.click();
  assert.equal(btn.textContent, '🔕');
  assert.match(toasts.join('\n'), /허락하지 않아서 켜지 않았어요/);
});

test('허락을 막아 두었으면 막혀 있다고, 허락하면 켜졌다고 알려 준다', async () => {
  let b = browser({ permission: 'default', ask: 'denied' });
  let toasts = [];
  createAlerts({ toast: t => toasts.push(t), show() {}, quiet: () => false });
  await b.btn.click();
  assert.equal(b.btn.textContent, '🔕');
  assert.match(toasts.join('\n'), /알림이 막혀 있어요/);

  b = browser({ permission: 'default', ask: 'granted' });
  toasts = [];
  createAlerts({ toast: t => toasts.push(t), show() {}, quiet: () => false });
  await b.btn.click();
  assert.equal(b.btn.textContent, '🔔');
  assert.equal(b.store.get('claude-office-notify'), '1');
  assert.match(toasts.join('\n'), /알려 드려요/);
});

test('옛 Safari처럼 허락을 콜백으로만 답해도 켜진다', async () => {
  const b = browser({ permission: 'default' });
  window.Notification.requestPermission = done => { setTimeout(() => { window.Notification.permission = 'granted'; done('granted'); }, 10); };
  createAlerts({ toast() {}, show() {}, quiet: () => false });
  await b.btn.click();
  assert.equal(b.btn.textContent, '🔔');
});

test('같은 세션 알림을 또 띄우면 다시 울리고, 허락·답을 하고 나면 떠 있던 기다림 알림을 닫는다', async () => {
  const { btn, made } = browser();
  const al = createAlerts({ toast() {}, show() {}, quiet: () => false });
  await btn.click();
  // 같은 tag로 바꿔 띄워도 renotify가 있어야 Chrome이 소리·배너를 다시 낸다 (전에는 응답 완료 알림이 남아 있으면 조용히 바뀌었다)
  al.notify(s, '✅ 응답 완료', '다 했어요');
  al.notifyWait(s, { kind: 'permission', tool: 'Bash', label: 'git push' });
  assert.deepEqual(made.map(n => [n.title, n.tag, n.renotify]), [['✅ 응답 완료', 'claude-office-sid-1', true], ['🔐 실행 허락을 기다려요', 'claude-office-sid-1', true]]);
  al.waitDone('sid-1');
  assert.deepEqual(made.map(n => n.closed), [false, true]);
  al.waitDone('sid-1'); // 두 번 불러도 괜찮다
  // 기다림 뒤에 응답 완료가 오면 그 알림은 기다림이 아니라서 닫지 않는다
  al.notifyWait(s, { kind: 'input', text: '어느 쪽으로 할까요?' });
  al.notify(s, '✅ 응답 완료', '골랐어요');
  al.waitDone('sid-1');
  assert.deepEqual(made.slice(2).map(n => [n.title, n.closed]), [['🔐 입력을 기다려요', false], ['✅ 응답 완료', false]]);
  // ❓ 질문 알림도 기다림처럼 넘기면(w) 답한 뒤 닫힌다
  al.notify(s, '❓ 물어볼 게 있어요', '어느 쪽으로 할까요?', { on: '' });
  al.waitDone('sid-1');
  assert.deepEqual([made.at(-1).title, made.at(-1).closed], ['❓ 물어볼 게 있어요', true]);
  // 다른 세션의 기다림은 건드리지 않는다
  al.notifyWait({ sid: 'sid-2', main: { name: '배포' } }, { kind: 'permission', tool: 'Bash', label: 'npm publish' });
  al.waitDone('sid-1');
  assert.equal(made.at(-1).closed, false);
});

test('탭 아이콘: 기다리는 수를 빨간 숫자로, 사무실 서버가 꺼졌으면 회색 얼굴로 (숫자 없이)', () => {
  const { fav } = browser();
  const al = createAlerts({ toast() {}, show() {}, quiet: () => false });
  const look = () => { const svg = decodeURIComponent(fav.href); return [svg.match(/rx="19" fill="(#\w+)"/)[1], (svg.match(/<text[^>]*>([^<]+)</) || [])[1] || '']; };
  al.setFavicon(0);
  assert.deepEqual(look(), ['#D97757', '']);
  al.setFavicon(12);
  assert.deepEqual(look(), ['#D97757', '9+']);
  al.setFavicon(0, true);
  assert.deepEqual(look(), ['#9ca3af', '']);
  al.setFavicon(2);
  assert.deepEqual(look(), ['#D97757', '2']);
});
