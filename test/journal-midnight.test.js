// 업무 일지 창(public/js/journal.js)을 열어 둔 채 자정을 넘겨도 ◀ ▶·막대가 보던 날을 기준으로 움직인다.
// 일지는 '오늘이 0, 어제가 -1'처럼 오늘에서 떨어진 수로 날을 가리켜서, 날이 바뀌면 같은 수가 다른 날을 가리켰다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// 일지 창에 쓰는 요소만 흉내 낸다 (글자·숨김·이벤트만)
function el() {
  const on = {};
  const cls = new Set();
  return {
    hidden: true, innerHTML: '', title: '', disabled: false, dataset: {}, attrs: {},
    style: { setProperty() {}, removeProperty() {} },
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, v) => (v ? cls.add(c) : cls.delete(c)), contains: c => cls.has(c) },
    setAttribute(k, v) { this.attrs[k] = v; }, focus() {}, isConnected: true,
    addEventListener(type, fn) { on[type] = fn; }, fire(type, e) { return on[type](e); },
  };
}

const at = (m, d, h = 0) => new Date(2026, m - 1, d, h).getTime();
const DAY = 86400000;
const midnight = t => new Date(t).setHours(0, 0, 0, 0);
let clock = at(11, 20, 15); // 금요일 오후 3시
const asked = []; // 받아 온 일지 (쿼리)

let createJournal;
test.before(async () => {
  const els = new Map();
  globalThis.document = { getElementById: id => { if (!els.has(id)) els.set(id, el()); return els.get(id); }, addEventListener() {}, activeElement: null, hidden: false };
  globalThis.setInterval = fn => { globalThis.tick = fn; return 0; }; // 1분마다 도는 '날이 바뀌었나' 확인은 직접 부른다
  // 서버처럼: 오늘에서 떨어진 날·주를 그날 0시로
  globalThis.fetch = async url => {
    const q = new URLSearchParams(url.split('?')[1]);
    asked.push(url.split('?')[1]);
    const today = midnight(clock);
    let body;
    if (q.has('week')) {
      const monday = today - ((new Date(today).getDay() + 6) % 7) * DAY + Number(q.get('week')) * 7 * DAY;
      const days = Array.from({ length: 7 }, (_, i) => ({ since: new Date(monday).setDate(new Date(monday).getDate() + i), workedMs: 60000, tools: 1 })).filter(d => d.since <= today);
      body = { week: Number(q.get('week')), today: q.get('week') === '0', title: '주간 업무 일지', days, totals: {}, worked: days.length, projects: [], md: '' };
    } else {
      const since = new Date(today).setDate(new Date(today).getDate() + Number(q.get('day')));
      body = { since, today: q.get('day') === '0', hours: [], totals: {}, projects: [], md: '' };
    }
    return { ok: true, json: async () => body };
  };
  ({ createJournal } = await import('../public/js/journal.js'));
});
test.after(() => { for (const k of ['document', 'setInterval', 'fetch', 'tick']) delete globalThis[k]; });

const $ = id => document.getElementById(id);
const settle = () => new Promise(r => setImmediate(r));
const title = () => $('journalTitle').innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('어제 일지를 열어 둔 채 자정을 넘기면: 같은 날을 다시 그리고, ◀ ▶는 그날에서 하루씩', async () => {
  const j = createJournal({ toast() {}, onPick() {}, copy: async () => true, now: () => clock });
  j.open(-1);
  await settle();
  assert.equal(title(), '📓 11월 19일 업무 일지 어제');

  clock = at(11, 21, 0) + 60000; // 토요일 0시 1분
  // 전에는 아무것도 안 하다가 ◀를 누르면 -2(= 다시 11월 19일), ▶는 0(= 11월 21일, 20일을 건너뜀)
  globalThis.tick();
  await settle();
  assert.equal(title(), '📓 11월 19일 업무 일지 2일 전');
  j.prev();
  await settle();
  assert.equal(title(), '📓 11월 18일 업무 일지 3일 전');
  j.next();
  await settle();
  assert.equal(title(), '📓 11월 19일 업무 일지 2일 전');
  j.next();
  await settle();
  assert.equal(title(), '📓 11월 20일 업무 일지 어제');
});

test('자정을 넘긴 뒤 1분 확인보다 먼저 눌러도 보던 날에서 움직이고, 주간 막대도 그린 날 기준', async () => {
  clock = at(11, 20, 23); // 금요일 밤 11시
  const j = createJournal({ toast() {}, onPick() {}, copy: async () => true, now: () => clock });
  j.open(-1);
  await settle();
  assert.equal(title(), '📓 11월 19일 업무 일지 어제');
  clock = at(11, 21, 9); // 자고 일어나 토요일 아침에 바로 ◀
  j.prev();
  await settle();
  assert.equal(asked.at(-1), 'day=-3');
  assert.equal(title(), '📓 11월 18일 업무 일지 3일 전');

  // 주간(W)으로 가서 월요일 막대를 그려 둔 채 다음 날이 되어 누르면 그 월요일 일지
  j.toggleWeek();
  await settle();
  const mon = $('journalHours').innerHTML.match(/data-day="(-?\d+)"/)[1];
  assert.equal(mon, '-5'); // 토요일에서 본 월요일
  clock = at(11, 22, 10); // 일요일 (같은 주)
  const target = { dataset: { day: mon } };
  $('journal').fire('click', { target: { closest: s => (s === '[data-day]' ? target : null) }, currentTarget: $('journal') });
  await settle();
  assert.equal(asked.at(-1), 'day=-6');
  assert.equal(title(), '📓 11월 16일 업무 일지 6일 전');
});

test("'이 프로젝트만'으로 고르면 이름이 꼭 같은 프로젝트만 받아 온다 (exact=1: 'blog'에 'blog-admin'이 섞이지 않게)", async () => {
  clock = at(11, 20, 15);
  const j = createJournal({ toast() {}, onPick() {}, copy: async () => true, now: () => clock });
  j.open(0);
  await settle();
  const only = { dataset: { project: 'blog', cwd: '/Users/me/work/blog' } };
  $('journal').fire('click', { target: { closest: s => (s === '.jp-only' ? only : null) }, currentTarget: $('journal') });
  await settle();
  // 그 폴더의 것만 (이름이 같은 다른 폴더의 blog는 빼고)
  assert.equal(asked.at(-1), 'day=0&project=blog&exact=1&cwd=%2FUsers%2Fme%2Fwork%2Fblog');
});
