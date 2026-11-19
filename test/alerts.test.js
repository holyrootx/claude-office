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
      made.push({ title, ...opts });
    }
    close() {}
  }
  Notification.permission = permission;
  Notification.requestPermission = () => { Notification.permission = ask; return Promise.resolve(ask); };
  globalThis.window = { Notification, focus() {} };
  globalThis.Notification = Notification;
  globalThis.document = { getElementById: id => (id === 'notifyBtn' ? btn : { href: '' }), visibilityState: 'hidden', hasFocus: () => false };
  globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  return { btn, store, made };
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
