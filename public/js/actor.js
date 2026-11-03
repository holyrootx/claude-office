// 캐릭터 한 명: 세션의 메인 Claude(직원) 또는 서브에이전트(인턴). 받은 이벤트를 차례로 연출한다.
import { esc, clamp, clip, sleep, secs, fmtTokens, compactHow } from './util.js';
import { ROOMS, W, LANE_Y, SPEED, slotPoint, doorInside } from './scene.js';

class Abort extends Error {}
const MODES = ['walk', 'work', 'think', 'error', 'ask', 'permit', 'report', 'talk', 'sleep', 'idle'];
const PROPS = ['p-book', 'p-laptop', 'p-terminal', 'p-glass', 'p-marker', 'p-paper'];
const EXIT = { x: 1196, y: LANE_Y }; // 인턴이 퇴근하는 복도 끝

export class Actor {
  // office: 화면 전체(자리 배정·화이트보드·나의 말풍선 등을 맡는다)
  constructor(office, { key, sid, agent = '', intern = false, name = '', color = '#D97757', floor = '' }) {
    Object.assign(this, { office, key, sid, agent, intern, name, floor });
    this.home = intern ? 'meeting' : 'desk';

    this.wrap = document.createElement('div');
    this.wrap.className = 'actor' + (intern ? ' intern' : '');
    this.wrap.style.setProperty('--claude', intern ? `color-mix(in srgb, ${color} 62%, #fff)` : color);
    this.el = document.getElementById('charTpl').content.firstElementChild.cloneNode(true);
    this.tag = this.el.querySelector('.name-tag');
    this.pile = this.el.querySelector('.pile');
    this.bubble = Object.assign(document.createElement('div'), { className: 'bubble' });
    this.sign = Object.assign(document.createElement('div'), { className: 'tool-sign' });
    this.pop = Object.assign(document.createElement('div'), { className: 'check-pop', textContent: '✓' });
    this.wrap.append(this.el, this.sign, this.pop, this.bubble);
    // 캐릭터를 누르면 자세한 정보 카드를 연다
    this.el.addEventListener('click', e => {
      e.stopPropagation();
      if (office.select) office.select(this);
    });
    office.actorsEl.appendChild(this.wrap);

    this.x = 0;
    this.y = 0;
    this.room = null;
    this.slotRoom = null;
    this.slot = 0;
    this.path = [];
    this.target = null;
    this.resolve = this.reject = null;
    this.facing = 1;
    this.queue = [];
    this.pending = new Map();
    this.known = new Map();
    this.gen = 0;
    this.running = false;
    this.mode = 'idle';
    this.turnOpen = false;
    this.lastRoom = this.home;
    this.lastEventTs = 0;
    this.lastActivity = Date.now();
    this.lastThought = '';
    this.lastSay = '';
    this.bubbleKind = null;
    this.bubbleAt = 0;
    this.signTool = null;
    this.waitState = null;
    this.shownWait = 0;
    this.leaving = false;
    this.now = { icon: '☕', title: '준비 중', sub: '', room: this.home, mode: '', time: '' };
    this.hl = this.home;
    this.sweatTimer = this.popTimer = 0;
  }

  destroy() {
    this.abortAll();
    this.queue.length = 0;
    clearTimeout(this.sweatTimer);
    clearTimeout(this.popTimer);
    this.wrap.remove();
  }

  // 컨텍스트가 찬 만큼 발치에 서류가 쌓인다 (20%마다 한 장, 60%부터 노랑, 85%부터 빨강).
  // 대화를 압축해서 줄어들면 정리하는 모습을 한 번 보여 준다. 값이 바뀔 때만 DOM을 고친다.
  setPile(p) {
    const n = p ? Math.min(5, Math.ceil(p / 20)) : 0;
    const level = p >= 85 ? 'high' : p >= 60 ? 'mid' : 'low';
    const key = n + level;
    if (key === this.pileKey) return;
    const shrank = this.pileN > n && n > 0;
    this.pileKey = key;
    this.pileN = n;
    this.pile.hidden = !n;
    this.pile.className = `pile ${level}${shrank ? ' filed' : ''}`;
    this.pile.innerHTML = '<i></i>'.repeat(n);
    this.pile.style.setProperty('--n', n); // 포스트잇을 맨 위 종이에 붙이려고
    this.pile.title = n ? `컨텍스트 ${p}%` : '';
  }

  setTag(text) {
    if (this.tag.textContent !== text) this.tag.textContent = text;
    this.tag.hidden = !text;
  }

  // ───────────────────────── 모습 ─────────────────────────
  setMode(m, room) {
    this.mode = m;
    const c = this.el.classList;
    c.remove(...MODES, ...PROPS);
    c.add(m);
    if (m === 'work' && room && ROOMS[room]) c.add('p-' + ROOMS[room].prop);
  }
  setFacing(f) {
    this.facing = f;
    this.el.classList.toggle('left', f < 0);
  }
  sweat(ms) {
    this.el.classList.add('sweating');
    clearTimeout(this.sweatTimer);
    this.sweatTimer = setTimeout(() => this.el.classList.remove('sweating'), ms);
  }
  setNow(icon, title, sub, room, mode) {
    this.now = { icon, title, sub: sub || '', room: room || '', mode: mode || '', time: '' };
  }
  highlight(room) {
    this.hl = room;
  }

  showBubble(kind, html) {
    const b = this.bubble;
    const same = this.bubbleKind === kind && b.classList.contains('show');
    b.className = 'bubble ' + kind + (same ? ' show' : '');
    b.innerHTML = html;
    this.bubbleKind = kind;
    this.bubbleAt = Date.now();
    this.placeBubble();
    if (!same) {
      void b.offsetWidth; // 리플로를 강제해서 등장 전환이 다시 재생되게
      b.classList.add('show');
    }
  }
  hideBubble() {
    this.bubble.classList.remove('show');
    this.bubbleKind = null;
  }
  thinkCloud(text) {
    this.showBubble('think', `<i class="puff-top"></i><span class="txt">${text ? esc(text) : '생각 중<span class="dots"><i></i><i></i><i></i></span>'}</span><i class="puff p1"></i><i class="puff p2"></i>`);
  }
  askBubble(q, options) {
    const opts = options && options.length ? `<div class="opts">${options.map(o => `<span>${esc(o)}</span>`).join('')}</div>` : '';
    this.showBubble('ask', `<span class="q">?</span>${esc(q)}${opts}`);
  }
  permitBubble(w) {
    const head = w.kind === 'input' ? '입력을 기다리고 있어요' : w.agent && !this.intern ? '서브에이전트가 허락을 기다려요' : '이거 실행해도 될까요?';
    const what = w.tool ? `<b>${esc(w.tool)}</b> ${esc(w.label || '')}` : esc(w.text || '터미널에서 확인해 주세요');
    const detail = w.detail && w.detail !== w.label ? `<span class="detail">${esc(clip(w.detail, 90))}</span>` : '';
    this.showBubble('permit', `<span class="key">🔐</span><span class="head">${head}</span><span class="what">${what}</span>${detail}`);
  }
  placeBubble() {
    if (!this.bubbleKind) return;
    const b = this.bubble;
    const w = b.offsetWidth, h = b.offsetHeight;
    const think = this.bubbleKind === 'think';
    const top0 = this.intern ? 58 : 80; // 인턴은 키가 작다
    const left = clamp(this.x - w / 2, 8, W - w - 8);
    let top = this.y - top0 - h - (think ? 30 : 14);
    let below = false;
    if (top < 6) { top = this.y + (this.signTool ? 40 + (this.slot % 3) * 22 : 14) + (think ? 22 : 8); below = true; }
    const tail = clamp(this.x - left, 20, w - 20);
    const key = `${left}|${top}|${tail}|${below}`;
    if (key === this.bubbleAtKey) return; // 그대로면 고쳐 쓰지 않는다
    this.bubbleAtKey = key;
    b.style.left = left + 'px';
    b.style.top = top + 'px';
    b.style.setProperty('--tail-x', tail + 'px');
    b.classList.toggle('below', below);
  }

  showSign(ev) {
    this.signTool = ev;
    const s = this.sign;
    s.style.setProperty('--c', `var(--${ev.room})`);
    s.className = 'tool-sign show';
    s.innerHTML = `${ev.git ? '<span class="git">git</span>' : ''}<b>${esc(ev.tool || ev.name)}</b>${ev.label ? `<span>${esc(ev.label)}</span>` : ''}<em></em>`;
  }
  hideSign() {
    this.sign.classList.remove('show');
    this.signTool = null;
  }
  popCheck() {
    this.pop.classList.remove('go');
    void this.pop.offsetWidth;
    this.pop.classList.add('go');
    clearTimeout(this.popTimer);
    this.popTimer = setTimeout(() => this.pop.classList.remove('go'), 900);
  }

  // ───────────────────────── 이동 ─────────────────────────
  spot(room) {
    return this.slotRoom === room ? slotPoint(room, this.slot) : slotPoint(room, 0);
  }
  atSpot(room) {
    if (this.room !== room || this.slotRoom !== room) return false;
    const s = slotPoint(room, this.slot);
    return Math.hypot(this.x - s.x, this.y - s.y) < 2;
  }
  routeTo(room) {
    this.office.claim(this, room);
    const to = ROOMS[room];
    const s = slotPoint(room, this.slot);
    const spot = { x: s.x, y: s.y, enter: room };
    if (this.room === room) return this.atSpot(room) ? [] : [spot];
    const pts = [];
    const from = ROOMS[this.room];
    if (from) {
      for (const v of (from.via || []).slice().reverse()) pts.push({ x: v[0], y: v[1] });
      pts.push(doorInside(from), { x: from.door, y: LANE_Y, enter: null });
    } else pts.push({ x: this.x, y: LANE_Y, enter: null });
    pts.push({ x: to.door, y: LANE_Y }, { ...doorInside(to), enter: room });
    for (const v of to.via || []) pts.push({ x: v[0], y: v[1] });
    pts.push(spot);
    return pts;
  }
  walkTo(room) {
    return this.walkPath(this.routeTo(room), room);
  }
  walkPath(pts, room) {
    if (!pts.length) return Promise.resolve();
    this.hideSign();
    this.setMode('walk');
    return new Promise((resolve, reject) => {
      this.path = pts;
      this.target = room;
      this.resolve = resolve;
      this.reject = reject;
      if (this.office.wake) this.office.wake(); // 걷는 동안은 매 프레임 그린다
    });
  }
  teleport(room) {
    this.office.claim(this, room);
    const s = slotPoint(room, this.slot);
    this.path = [];
    this.x = s.x;
    this.y = s.y;
    this.room = room;
    this.setFacing(ROOMS[room].face);
    this.highlight(room);
    this.step(0);
  }
  // 복도에서 나타나기 (새 인턴이 출근할 때)
  appearInHall(x) {
    this.x = x;
    this.y = LANE_Y;
    this.room = null;
    this.slotRoom = null;
    this.step(0);
  }
  abortAll() {
    this.gen++;
    this.path = [];
    const rj = this.reject;
    this.resolve = this.reject = null;
    if (rj) rj(new Abort());
  }
  speedFactor() {
    const n = this.queue.length;
    const f = n <= 1 ? 1 : Math.min(7, 1 + (n - 1) * 0.5);
    return this.waitState && n ? Math.max(f, 3) : f; // 내 허락을 기다리는 중이면 밀린 장면을 빨리 넘긴다
  }
  async dwell(ms) {
    const g = this.gen;
    let t = 0;
    while (t < ms) {
      await sleep(40);
      if (g !== this.gen) throw new Abort();
      t += 40 * this.speedFactor();
    }
  }

  step(dt) {
    let budget = SPEED * this.speedFactor() * dt;
    while (this.path.length && budget > 0) {
      const p = this.path[0];
      const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy);
      if (Math.abs(dx) > 0.5) this.setFacing(dx > 0 ? 1 : -1);
      if (d > budget) {
        this.x += (dx / d) * budget;
        this.y += (dy / d) * budget;
        break;
      }
      budget -= d;
      this.x = p.x;
      this.y = p.y;
      if ('enter' in p) this.room = p.enter;
      this.path.shift();
      if (!this.path.length) {
        this.room = this.target;
        if (ROOMS[this.room]) this.setFacing(ROOMS[this.room].face);
        const r = this.resolve;
        this.resolve = this.reject = null;
        if (r) r();
      }
    }
    // 매 프레임 부르지만, 자리가 그대로면 아무것도 고쳐 쓰지 않는다
    // (안 움직이는데도 스타일을 쓰고 크기를 다시 재면 브라우저가 매 프레임 다시 계산해서 CPU를 꽤 먹는다)
    const key = `${this.x.toFixed(1)}|${this.y.toFixed(1)}|${this.tag.hidden}|${this.slot}`;
    if (key !== this.drawnKey) {
      this.drawnKey = key;
      this.el.style.transform = `translate(${(this.x - 32).toFixed(1)}px, ${(this.y - 78).toFixed(1)}px)`;
      this.el.style.zIndex = 20 + Math.round(this.y / 10); // 앞(아래)에 선 사람이 위에 보이게
      // 표지판은 이름표 아래에, 옆자리 사람과 겹치지 않게 자리 번호마다 조금씩 내려 단다
      const signY = this.y + (this.tag.hidden ? 8 : 24) + (this.slot % 3) * 22;
      this.sign.style.transform = `translate(calc(-50% + ${this.x.toFixed(1)}px), ${signY.toFixed(1)}px)`;
      this.pop.style.left = (this.x + 18).toFixed(1) + 'px';
      this.pop.style.top = (this.y - (this.intern ? 70 : 92)).toFixed(1) + 'px';
    }
    this.placeBubble();
  }

  // ───────────────────────── 이벤트 처리 ─────────────────────────
  lastPending() {
    let p = null;
    for (const v of this.pending.values()) p = v;
    return p;
  }
  // 기록이 한참 조용하면 끝난 일로 보고 정리한다. 다만 기다리는 일의 종류에 따라 참는 시간이 다르다:
  // 나에게 한 질문은 12시간, 실행 중인 도구는 30분, 그냥 생각 중은 10분.
  // 같은 세션의 인턴이 아직 일하고 있으면 그 시각까지 친다 (서브에이전트를 기다리는 동안 메인 기록은 조용하다).
  stale() {
    const last = Math.max(this.lastEventTs, this.office.activityOf ? this.office.activityOf(this) : 0);
    if (!last) return false;
    const p = this.lastPending();
    const limit = p && p.ask ? 12 * 60 : p ? 30 : 10;
    return Date.now() - last > limit * 60 * 1000;
  }
  toolTitle(ev) {
    const t = this.known.get(ev.id);
    return (t && t.tool) || ev.name || '도구';
  }

  bookkeep(ev) {
    if (ev.ts) this.lastEventTs = Math.max(this.lastEventTs, ev.ts);
    // 정보 카드에 쓸 숫자: 쓴 도구 수, 처음 일을 시작한 때 (인턴 카드에 보인다)
    if (ev.ts && (!this.firstTs || ev.ts < this.firstTs)) this.firstTs = ev.ts;
    if (ev.k === 'tool') this.toolCount = (this.toolCount || 0) + 1;
    if (ev.k === 'say' && ev.final) this.doneTs = ev.ts;
    switch (ev.k) {
      case 'user': case 'agent': this.turnOpen = true; break;
      case 'think': if (ev.text) this.lastThought = ev.text; this.turnOpen = true; break;
      case 'tool':
        this.turnOpen = true;
        this.pending.set(ev.id, ev);
        this.known.set(ev.id, ev);
        if (this.known.size > 600) this.known.delete(this.known.keys().next().value);
        this.lastRoom = ev.room;
        break;
      case 'result': this.pending.delete(ev.id); break;
      case 'say': if (ev.final) { this.turnOpen = false; this.pending.clear(); this.lastRoom = this.home; this.lastSay = ev.text; } break;
      case 'turn_end': case 'interrupt': this.turnOpen = false; this.pending.clear(); break;
      // 사용 한도나 끝내 멈춘 오류면 이번 차례는 끝난다. 다시 일할 때까지 왜 멈췄는지 보여 준다
      // (서버가 붐벼서 다시 시도하는 중인 오류는 stop이 없다)
      case 'apierr': if (ev.stop || ev.kind === 'limit') { this.turnOpen = false; this.pending.clear(); this.halt = ev; } break;
    }
    // 다시 일하기 시작하면(내 말, 생각, 도구, 대답) 멈춤은 풀린 것이다
    if (this.halt && /^(user|think|tool|say)$/.test(ev.k)) this.halt = null;
  }

  // 처음 화면을 그릴 때: 지난 기록으로 상태만 맞추고 지금 있어야 할 곳에 바로 세운다
  load(history, wait) {
    for (const ev of history) this.bookkeep(ev);
    this.waitState = wait || null;
    if (this.stale() && !this.waitState) { this.turnOpen = false; this.pending.clear(); }
    const p = this.lastPending();
    this.teleport(this.waitState || (p && p.ask) ? 'desk' : p ? p.room : this.turnOpen ? this.lastRoom : this.home);
    this.setMode('idle');
    this.lastActivity = this.lastEventTs || Date.now();
    this.rest();
  }

  ingest(events) {
    for (const ev of events) this.queue.push(ev);
    this.pump();
  }

  async perform(ev) {
    this.bookkeep(ev);
    this.lastActivity = Date.now();
    switch (ev.k) {
      case 'agent':
        this.setMode('talk');
        this.showBubble('say', `<span class="tag intern-tag">인턴</span>${esc(ev.desc || ev.type || '도와주러 왔어요')}`);
        this.setNow('👋', `${ev.type || '서브에이전트'} 인턴이 왔어요`, ev.desc, this.home);
        await this.dwell(1400);
        break;
      case 'user':
        if (this.intern) {
          // 인턴이 받는 '사용자' 메시지는 메인 Claude가 맡긴 일이다
          if (this.bubbleKind && this.bubbleKind !== 'think') this.hideBubble();
          this.setNow('📋', '일을 받았어요', ev.text, this.room || this.home);
          await this.dwell(600);
          break;
        }
        this.office.userSay(this, ev.text);
        if (this.bubbleKind && this.bubbleKind !== 'think') this.hideBubble();
        this.setMode('idle');
        this.setNow('🙋', '새 요청이 들어왔어요', ev.text, 'desk');
        await this.dwell(800);
        break;
      case 'think':
        if (!ev.text) { if (!this.queue.length) { this.setMode('think'); this.thinkCloud(''); } await this.dwell(200); break; }
        this.setMode('think');
        this.thinkCloud(ev.text);
        this.setNow('💭', '생각 중', ev.text, this.room, 'think');
        await this.dwell(2600);
        break;
      case 'tool': await this.doTool(ev); break;
      case 'result': await this.doResult(ev); break;
      case 'say': await this.doSay(ev); break;
      case 'turn_end':
        if (!this.atSpot(this.home)) { this.hideBubble(); await this.walkTo(this.home); this.setMode('idle'); }
        break;
      case 'interrupt':
        this.hideSign();
        this.setMode('error');
        this.sweat(2600);
        this.showBubble('error', '<span class="head">✋ 중단됐어요</span><span class="msg">사용자가 작업을 멈췄어요</span>');
        this.setNow('✋', '사용자가 작업을 중단했어요', '', this.room, 'error');
        await this.dwell(2200);
        break;
      case 'compact': {
        const how = compactHow(ev);
        const size = ev.pre && ev.post ? `${fmtTokens(ev.pre)} → ${fmtTokens(ev.post)} 토큰` : '';
        this.setMode('talk');
        this.showBubble('say', `🗜 대화가 길어져서 앞부분을 요약했어요${size ? `<br><small>${how} · ${size}</small>` : ''}`);
        this.setNow('🗜', '대화 압축', size ? `${how} · ${size}` : '', this.room);
        await this.dwell(2000);
        break;
      }
      case 'apierr':
        if (ev.kind === 'limit') {
          this.setMode('sleep');
          this.showBubble('say', `⏳ 사용 한도에 걸려서 쉬어요${ev.resets ? `<br><small>${esc(ev.resets)}에 다시 열려요</small>` : ''}`);
          this.setNow('⏳', '사용 한도에 걸려서 쉬어요', ev.resets ? `${ev.resets}에 다시 열려요` : '한도가 풀리면 다시 일해요', this.room);
          await this.dwell(2400);
          break;
        }
        this.setMode('error');
        this.sweat(3000);
        this.showBubble('error', `<span class="head">⚠ API 오류</span><span class="msg">${esc(ev.text)}</span>`);
        this.setNow('😰', 'API 오류', ev.text, this.room, 'error');
        await this.dwell(2800);
        break;
    }
  }

  async doTool(ev) {
    const r = ROOMS[ev.room] || ROOMS.dev;
    const sub = `${ev.tool}${ev.label ? ' · ' + ev.label : ''}`;
    if (!this.atSpot(ev.room)) {
      if (this.bubbleKind !== 'think') this.hideBubble();
      this.highlight(ev.room);
      this.setNow('🚶', `${r.name}로 가는 중`, sub, ev.room);
      await this.walkTo(ev.room);
    }
    if (this.bubbleKind === 'think' || this.bubbleKind === 'error' || (this.bubbleKind && Date.now() - this.bubbleAt > 1500)) this.hideBubble();
    this.el.classList.remove('sweating');
    this.highlight(ev.room);
    this.setMode('work', ev.room);
    this.showSign(ev);
    this.setNow(r.icon, `${r.name} · ${ev.tool}`, ev.label || ev.detail || r.sub, ev.room);
    if (ev.plan && !this.intern) {
      const n = this.office.plan(this, ev.plan, ev.room === 'meeting');
      if (ev.room === 'meeting') await this.dwell(500 + n * 180);
    }
    if (ev.ask) {
      if (ev.room !== 'desk') {
        await this.dwell(800);
        await this.walkTo('desk');
      }
      this.hideSign();
      this.highlight('desk');
      this.setMode('ask');
      this.askBubble(ev.ask, ev.options);
      this.setNow('❓', '물어볼 게 있어서 찾아왔어요', ev.ask, 'desk');
      await this.dwell(2600);
      return;
    }
    await this.dwell(ev.room === 'desk' ? 1500 : 950);
  }

  async doResult(ev) {
    const mine = this.signTool && this.signTool.id === ev.id;
    if (!ev.ok) {
      if (mine) this.sign.classList.add('fail');
      this.setMode('error', ev.room);
      this.sweat(8000);
      const name = this.toolTitle(ev);
      this.showBubble('error', `<span class="head">⚠ ${esc(name)} 실패</span><span class="msg">${esc(ev.error)}</span>`);
      this.setNow('😰', `${name} 실패 — 식은땀 나는 중`, ev.error, ev.room || this.room, 'error');
      await this.dwell(2800);
      return;
    }
    if (mine) {
      this.sign.classList.add('ok');
      this.popCheck();
    }
    if (ev.answer) {
      this.office.userSay(this, '답변: ' + ev.answer);
      if (this.bubbleKind === 'ask') this.hideBubble();
      this.setMode('idle');
      await this.dwell(900);
    } else if (mine) await this.dwell(220);
  }

  async doSay(ev) {
    if (ev.final) {
      this.hideSign();
      if (this.intern) {
        // 인턴은 그 자리에서 결과를 말하고 퇴근한다
        this.setMode('report');
        this.showBubble('say final', `<span class="tag">완료</span>${esc(clip(ev.text, 120))}`);
        this.setNow('✅', '맡은 일을 끝냈어요', ev.text, this.room || this.home);
        await this.dwell(clamp(1200 + ev.text.length * 16, 2200, 4200));
        this.hideBubble();
        await this.walkOut();
        return;
      }
      if (!this.atSpot('desk')) {
        this.hideBubble();
        this.highlight('desk');
        this.setNow('🚶', '결과를 보고하러 가는 중', ev.text, 'desk');
        await this.walkTo('desk');
      }
      this.highlight('desk');
      this.setMode('report');
      this.showBubble('say final', `<span class="tag">완료</span>${esc(ev.text)}`);
      this.setNow('✅', '응답 완료 · 다음 지시를 기다려요', ev.text, 'desk');
      await this.dwell(clamp(1500 + ev.text.length * 22, 2600, 6000));
      return;
    }
    this.setMode('talk');
    this.showBubble('say', esc(ev.text));
    this.setNow('💬', '진행 상황을 말하는 중', ev.text, this.room);
    await this.dwell(clamp(1200 + ev.text.length * 18, 1800, 4200));
  }

  // 인턴 퇴근: 복도 끝으로 걸어가서 사라진다
  async walkOut() {
    if (this.leaving) return;
    this.leaving = true;
    this.setNow('👋', '퇴근하는 중', this.name, this.room || this.home);
    const pts = [];
    const from = ROOMS[this.room];
    if (from) {
      for (const v of (from.via || []).slice().reverse()) pts.push({ x: v[0], y: v[1] });
      pts.push(doorInside(from), { x: from.door, y: LANE_Y, enter: null });
    }
    pts.push(EXIT);
    this.slotRoom = null;
    await this.walkPath(pts, null).catch(() => {});
    this.wrap.classList.add('gone');
    await sleep(400);
    this.office.remove(this);
  }

  fastForward(n) {
    for (let i = 0; i < n && this.queue.length; i++) {
      const ev = this.queue.shift();
      this.bookkeep(ev);
      if (ev.k === 'tool' && ev.plan && !this.intern) this.office.plan(this, ev.plan, false);
    }
    this.hideBubble();
    this.hideSign();
    const p = this.lastPending();
    this.teleport(p ? (p.ask ? 'desk' : p.room) : this.turnOpen ? this.lastRoom : this.home);
  }

  async pump() {
    if (this.running || this.leaving) return;
    this.running = true;
    const g = this.gen;
    try {
      while (this.queue.length && g === this.gen && !this.leaving) {
        if (this.queue.length > 40) this.fastForward(this.queue.length - 8);
        await this.perform(this.queue.shift());
      }
    } catch (e) {
      if (!(e instanceof Abort)) console.error(e);
    } finally {
      this.running = false;
    }
    if (this.leaving) return;
    if (this.queue.length) this.pump();
    else this.rest();
  }

  // 큐 밖에서 걷기(쉬러 가기 등): 도착하면 바로 자세를 다시 잡는다
  stroll(room) {
    this.walkTo(room).then(() => { this.setMode('idle'); this.rest(); }, () => {});
  }

  setWait(w) {
    const prev = this.waitState;
    this.waitState = w || null;
    if (!w && prev && this.bubbleKind === 'permit') this.hideBubble();
    this.rest();
  }

  // 큐가 비었을 때: 지금 상태(권한 대기 / 도구 실행 중 / 생각 중 / 질문 대기 / 쉬는 중)에 맞는 자세로
  rest() {
    if (this.running || this.path.length || this.leaving) return;
    const p = this.lastPending();
    const since = this.lastEventTs ? Math.max(0, Math.round((Date.now() - this.lastEventTs) / 1000)) : 0;
    if (this.waitState) {
      // 권한 확인 창이 떠 있다: 내 자리로 와서 허락서를 들고 기다린다
      const w = this.waitState;
      this.setNow('🔐', w.kind === 'input' ? '내 입력을 기다리고 있어요' : '실행 허락을 기다리고 있어요', w.tool ? `${w.tool}${w.label ? ' · ' + w.label : ''}` : w.text, 'desk', 'wait');
      this.now.time = secs(Math.round((Date.now() - w.ts) / 1000));
      this.highlight('desk');
      if (!this.atSpot('desk')) { this.hideSign(); this.hideBubble(); this.stroll('desk'); return; }
      if (this.mode !== 'permit' || this.bubbleKind !== 'permit' || this.shownWait !== w.ts) {
        this.hideSign();
        this.setMode('permit');
        this.permitBubble(w);
        this.shownWait = w.ts;
      }
      return;
    }
    if (this.stale()) {
      this.turnOpen = false;
      this.pending.clear();
    }
    if (p && !this.stale()) {
      if (p.ask) {
        if (!this.atSpot('desk')) { this.stroll('desk'); return; }
        if (this.mode !== 'ask' || this.bubbleKind !== 'ask') { this.setMode('ask'); this.askBubble(p.ask, p.options); }
        this.setNow('❓', '내 답을 기다리고 있어요', p.ask, 'desk');
        this.now.time = secs(Math.round((Date.now() - p.ts) / 1000));
        return;
      }
      if (!this.signTool || this.signTool.id !== p.id || this.mode !== 'work') {
        if (this.room !== p.room || !this.atSpot(p.room)) {
          this.highlight(p.room);
          this.setNow('🚶', `${ROOMS[p.room].name}로 가는 중`, `${p.tool}${p.label ? ' · ' + p.label : ''}`, p.room);
          this.stroll(p.room);
          return;
        }
        this.setMode('work', p.room);
        this.showSign(p);
        this.highlight(p.room);
      }
      if (this.bubbleKind && Date.now() - this.bubbleAt > 4000) this.hideBubble();
      const r = ROOMS[p.room];
      const s = Math.round((Date.now() - p.ts) / 1000);
      this.setNow(r.icon, `${r.name} · ${p.tool} 실행 중`, p.label || p.detail || r.sub, p.room);
      this.now.time = secs(s);
      const em = this.sign.querySelector('em');
      if (em) em.textContent = s >= 3 ? `${s}s` : '';
      return;
    }
    if (this.turnOpen) {
      if (!this.room) { this.stroll(this.home); return; } // 복도에 서 있으면 일단 자기 자리로
      // 방금 실패했다면 빨간 말풍선과 식은땀을 조금 더 보여 준다
      if (this.bubbleKind === 'error' && Date.now() - this.bubbleAt < 8000) return;
      if (this.mode !== 'think') this.setMode('think');
      if (this.signTool && Date.now() - this.bubbleAt > 1200) this.hideSign();
      if (this.bubbleKind !== 'think') this.thinkCloud('');
      this.setNow('💭', '생각 중…', this.lastThought || '다음에 할 일을 고민하고 있어요', this.room, 'think');
      this.now.time = secs(since);
      return;
    }
    this.hideSign();
    if (!this.atSpot(this.home)) { this.hideBubble(); this.stroll(this.home); return; }
    const idleMs = Date.now() - Math.max(this.lastActivity, this.lastEventTs || 0);
    // 사용 한도에 걸려 쉬는 중이거나 오류로 멈춘 채
    const h = this.activeHalt();
    if (h) {
      if (h.kind === 'limit') {
        if (this.mode !== 'sleep') this.setMode('sleep');
        this.setNow('⏳', '사용 한도에 걸려서 쉬어요', h.resets ? `${h.resets}에 다시 열려요` : '한도가 풀리면 다시 일해요', this.home);
      } else {
        if (this.mode !== 'idle' && !(this.bubbleKind === 'error' && Date.now() - this.bubbleAt < 8000)) this.setMode('idle');
        this.setNow('⚠', '오류로 일이 멈췄어요', `${h.text} · 다시 말을 걸면 이어서 해요`, this.home, 'error');
      }
      return;
    }
    if (idleMs > 45000) {
      if (this.mode !== 'sleep') { this.setMode('sleep'); this.hideBubble(); }
      this.setNow('😴', '쉬는 중', this.halt && this.halt.kind === 'limit' ? '사용 한도가 풀렸어요 · 지시가 오면 바로 일어나요' : '지시가 오면 바로 일어나요', this.home);
    } else {
      if (this.mode !== 'idle' && this.mode !== 'report') this.setMode('idle');
      if (this.bubbleKind && Date.now() - this.bubbleAt > 14000) this.hideBubble();
      this.setNow('✅', '대기 중 · 다음 지시를 기다려요', this.lastSay || '', this.home);
    }
    this.highlight(this.home);
  }

  // 로비 안내판에 쓸 한 줄 상태
  // 사용 한도나 오류로 멈춘 채인지 (반나절이 지나면 그냥 쉬는 걸로 본다)
  activeHalt() {
    const h = this.halt;
    if (!h || Date.now() - (h.ts || 0) >= 12 * 3600 * 1000) return null;
    if (h.kind === 'limit' && h.resetAt && Date.now() >= h.resetAt) return null; // 한도가 풀렸다
    return h;
  }
  get status() {
    if (this.waitState) return 'wait';
    const p = this.lastPending();
    if (p && p.ask) return 'ask';
    const h = !p && !this.running && !this.turnOpen && this.activeHalt();
    if (h) return h.kind === 'limit' ? 'limit' : 'stopped';
    if (this.mode === 'sleep') return 'sleep';
    if (this.mode === 'error') return 'error';
    if (p || this.running || this.path.length) return 'work';
    if (this.turnOpen) return 'think';
    return 'idle';
  }
}
