// Claude 사무실 — 서버가 보내는 세션 이벤트를 받아 캐릭터를 방마다 움직인다.
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const W = 1280, H = 800, LANE_Y = 392, SPEED = 430;

  // 방 정의: spot = 일하는 자리(발 위치), door = 복도 쪽 문 x, via = 문과 자리 사이 경유점, face = 도착 시 바라보는 방향
  const ROOMS = {
    library: { name: '자료실', icon: '📚', sub: '읽기·검색', x: 32, y: 32, w: 400, h: 300, door: 330, row: 'top', spot: [190, 268], prop: 'book', face: 1 },
    dev: { name: '개발실', icon: '💻', sub: '코드 수정', x: 448, y: 32, w: 400, h: 300, door: 648, row: 'top', spot: [648, 214], prop: 'laptop', face: 1 },
    server: { name: '서버실', icon: '🖥️', sub: '명령·git', x: 864, y: 32, w: 384, h: 300, door: 1000, row: 'top', spot: [1075, 268], prop: 'terminal', face: 1 },
    search: { name: '정보 검색실', icon: '🌐', sub: '웹·MCP', x: 32, y: 452, w: 400, h: 316, door: 330, row: 'bottom', spot: [225, 684], via: [[330, 664]], prop: 'glass', face: -1 },
    meeting: { name: '회의실', icon: '🗂️', sub: '계획', x: 448, y: 452, w: 460, h: 316, door: 850, row: 'bottom', spot: [834, 652], prop: 'marker', face: -1 },
    desk: { name: '내 자리', icon: '🙋', sub: '질문·보고', x: 924, y: 452, w: 324, h: 316, door: 1000, row: 'bottom', spot: [1008, 654], prop: 'paper', face: 1, signRight: true },
  };
  const ROOM_IDS = Object.keys(ROOMS);

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const clip = (s, n) => (s = String(s || ''), s.length > n ? s.slice(0, n - 1) + '…' : s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const hhmmss = ts => {
    const d = new Date(ts), p = n => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };

  // ───────────────────────── 바닥 그리기 ─────────────────────────
  let seed = 20261020;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  const plant = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><circle r="14" fill="#a0704a"/><circle r="11" fill="#6d4a2f"/><circle cx="-6" cy="-5" r="9" fill="#3f9d58"/><circle cx="6" cy="-6" r="9" fill="#4cb36a"/><circle cx="0" cy="5" r="9" fill="#358a4c"/><circle cx="1" cy="-1" r="6" fill="#6ad08a"/></g>`;
  const chair = (x, y, c = '#475569', back = '#334155') => `<g transform="translate(${x} ${y})"><rect x="-15" y="-13" width="30" height="26" rx="9" fill="${c}"/><rect x="-16" y="10" width="32" height="8" rx="4" fill="${back}"/></g>`;

  function bookshelf(x, y, w, h) {
    const colors = ['#e4572e', '#f3a712', '#29335c', '#669bbc', '#7fb069', '#c1121f', '#8e7dbe', '#f4d35e', '#2a9d8f', '#e76f51', '#3d5a80'];
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#7a4a24"/><rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" fill="#3f2512"/>`;
    let cx = x + 7;
    while (cx < x + w - 14) {
      const bw = 5 + Math.floor(rnd() * 6), bh = h - 12 - Math.floor(rnd() * 9);
      if (rnd() < 0.08) { s += `<rect x="${cx}" y="${y + h - 9}" width="${bh}" height="5" rx="1" fill="${colors[Math.floor(rnd() * colors.length)]}"/>`; cx += bh + 2; continue; }
      s += `<rect x="${cx}" y="${y + h - 5 - bh}" width="${bw}" height="${bh}" rx="1" fill="${colors[Math.floor(rnd() * colors.length)]}"/>`;
      if (bw > 7) s += `<rect x="${cx + 2}" y="${y + h - bh + 2}" width="${bw - 4}" height="2" fill="rgba(255,255,255,.35)"/>`;
      cx += bw + 1 + (rnd() < 0.12 ? 7 : 0);
    }
    return s;
  }

  function monitor(x, y, w, h, opts = {}) {
    const screen = opts.screen || '#1e293b';
    let s = `<rect x="${x + w / 2 - 4}" y="${y + h - 1}" width="8" height="7" fill="#64748b"/><rect x="${x + w / 2 - 12}" y="${y + h + 5}" width="24" height="3" rx="1.5" fill="#64748b"/>`;
    if (opts.glow) s += `<rect class="screen-glow" x="${x - 6}" y="${y - 6}" width="${w + 12}" height="${h + 12}" rx="8" fill="${opts.glow}" opacity="0" filter="url(#blur6)"/>`;
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#334155"/><rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="2" fill="${screen}"/>`;
    if (opts.code) {
      const cols = opts.colors || ['#60a5fa', '#f472b6', '#a3e635', '#fbbf24', '#c4b5fd'];
      const rows = Math.floor((h - 10) / 6);
      for (let i = 0; i < rows; i++) {
        const indent = (i % 3) * 5;
        const lw = Math.max(6, (w - 16 - indent) * (0.35 + rnd() * 0.65));
        s += `<rect class="code-line" x="${x + 7 + indent}" y="${y + 7 + i * 6}" width="${lw.toFixed(1)}" height="2.6" rx="1" fill="${cols[i % cols.length]}" style="animation-delay:${(i * 0.17).toFixed(2)}s"/>`;
      }
    }
    if (opts.browser) {
      s += `<rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="6" fill="#94a3b8"/><circle cx="${x + 7}" cy="${y + 6}" r="1.4" fill="#ef4444"/><circle cx="${x + 11}" cy="${y + 6}" r="1.4" fill="#f59e0b"/><circle cx="${x + 15}" cy="${y + 6}" r="1.4" fill="#22c55e"/>`;
      s += `<rect class="code-line" x="${x + 8}" y="${y + 13}" width="${w - 30}" height="4" rx="2" fill="#38bdf8"/>`;
      s += `<rect x="${x + 8}" y="${y + 21}" width="${(w - 16) / 2 - 2}" height="${h - 28}" rx="1.5" fill="#bae6fd"/><rect class="code-line" x="${x + w / 2 + 1}" y="${y + 21}" width="${(w - 16) / 2 - 2}" height="3" fill="#7dd3fc"/><rect class="code-line" x="${x + w / 2 + 1}" y="${y + 27}" width="${(w - 16) / 3}" height="3" fill="#7dd3fc" style="animation-delay:.3s"/>`;
    }
    return s;
  }

  function rack(x, y, w, h) {
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#0b1220" stroke="#3b475c" stroke-width="2"/>`;
    for (let uy = y + 8; uy < y + h - 12; uy += 13) {
      s += `<rect x="${x + 5}" y="${uy}" width="${w - 10}" height="10" rx="1.5" fill="#1a2436"/>`;
      const c = rnd() < 0.7 ? '#22c55e' : rnd() < 0.5 ? '#f59e0b' : '#38bdf8';
      s += `<rect class="led" x="${x + 9}" y="${uy + 3.5}" width="4" height="3" fill="${c}" style="animation-delay:-${(rnd() * 2.4).toFixed(2)}s"/>`;
      s += `<rect class="led" x="${x + 16}" y="${uy + 3.5}" width="4" height="3" fill="#22c55e" style="animation-delay:-${(rnd() * 2.4).toFixed(2)}s"/>`;
      s += `<rect x="${x + w - 24}" y="${uy + 4}" width="16" height="2" fill="#334155"/>`;
    }
    return s;
  }

  function buildFloor() {
    const defs = `
    <defs>
      <filter id="shadow" x="-5%" y="-5%" width="110%" height="115%"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000" flood-opacity=".45"/></filter>
      <filter id="blur6" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
      <pattern id="pWood" width="120" height="48" patternUnits="userSpaceOnUse"><rect width="120" height="48" fill="#ecd9b8"/><path d="M0 23.5 H120 M0 47.5 H120 M70 0 V24 M20 24 V48" stroke="#dcc39a"/></pattern>
      <pattern id="pWood2" width="140" height="44" patternUnits="userSpaceOnUse"><rect width="140" height="44" fill="#f3e3cf"/><path d="M0 21.5 H140 M0 43.5 H140 M90 0 V22 M30 22 V44" stroke="#e6cfb3"/></pattern>
      <pattern id="pDev" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#e4ebf5"/><path d="M0 39.5 H40 M39.5 0 V40" stroke="#d3ddec"/></pattern>
      <pattern id="pServer" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="#2a3140"/><path d="M0 31.5 H32 M31.5 0 V32" stroke="#3a4456"/><circle cx="16" cy="16" r="1.3" fill="#3f4a5f"/></pattern>
      <pattern id="pSearch" width="22" height="22" patternUnits="userSpaceOnUse"><rect width="22" height="22" fill="#dcf1eb"/><circle cx="11" cy="11" r="1.4" fill="#bfe2d8"/></pattern>
      <pattern id="pMeet" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="#e9e3f5"/><path d="M12 6 L18 12 L12 18 L6 12Z" fill="#e0d7f0"/></pattern>
      <pattern id="pHall" width="44" height="44" patternUnits="userSpaceOnUse"><rect width="44" height="44" fill="#e8e3d7"/><path d="M0 43.5 H44 M43.5 0 V44" stroke="#dcd5c5"/></pattern>
      <clipPath id="globeClip"><circle cx="98" cy="552" r="44"/></clipPath>
    </defs>`;

    const floors = { library: 'url(#pWood)', dev: 'url(#pDev)', server: 'url(#pServer)', search: 'url(#pSearch)', meeting: 'url(#pMeet)', desk: 'url(#pWood2)' };

    const furniture = {
      library: `
        ${bookshelf(46, 42, 372, 56)}
        <ellipse cx="190" cy="262" rx="100" ry="34" fill="#d6b07c" opacity=".45"/>
        ${bookshelf(80, 150, 220, 42)}
        <rect x="312" y="148" width="104" height="84" rx="8" fill="#9a6a3f"/><rect x="316" y="152" width="96" height="76" rx="6" fill="#bb8a5b"/>
        <path d="M336 174 h24 v26 h-24z" fill="#fff" stroke="#e5e7eb"/><path d="M360 174 h24 v26 h-24z" fill="#f8fafc" stroke="#e5e7eb"/>
        <path d="M340 181 h16 M340 186 h16 M340 191 h12 M364 181 h16 M364 186 h16 M364 191 h10" stroke="#cbd5e1" stroke-width="1.4"/>
        <circle cx="398" cy="164" r="18" fill="#fde68a" opacity=".3"/><circle cx="398" cy="164" r="8" fill="#fcd34d" stroke="#b45309" stroke-width="2"/>
        ${chair(343, 252, '#8b5a2b', '#6b4423')}${chair(386, 252, '#8b5a2b', '#6b4423')}
        <rect x="44" y="228" width="58" height="92" rx="5" fill="#9aa4b2"/><rect x="48" y="232" width="50" height="26" rx="2" fill="#b3bcc8"/><rect x="48" y="262" width="50" height="26" rx="2" fill="#b3bcc8"/><rect x="48" y="292" width="50" height="24" rx="2" fill="#b3bcc8"/>
        <rect x="66" y="242" width="14" height="4" rx="2" fill="#64748b"/><rect x="66" y="272" width="14" height="4" rx="2" fill="#64748b"/><rect x="66" y="301" width="14" height="4" rx="2" fill="#64748b"/>
        ${plant(410, 308, 0.9)}`,
      dev: `
        ${[0, 1, 2].map(i => {
          const x = 470 + i * 124;
          return `<rect x="${x}" y="50" width="112" height="58" rx="6" fill="#c9ad86"/><rect x="${x + 3}" y="53" width="106" height="52" rx="5" fill="#d9c3a5"/>
            ${monitor(x + 26, 56, 60, 34, { code: true, glow: i === 1 ? '#60a5fa' : '' })}
            <rect x="${x + 33}" y="96" width="46" height="7" rx="2" fill="#e2e8f0" stroke="#94a3b8" stroke-width=".8"/>
            <circle cx="${x + 92}" cy="98" r="5" fill="#fff" stroke="#f97316" stroke-width="1.6"/>
            ${chair(x + 56, 140, '#475569', '#334155')}`;
        }).join('')}
        <ellipse cx="648" cy="222" rx="70" ry="22" fill="#cfdaea" opacity=".7"/>
        <rect x="760" y="252" width="70" height="56" rx="10" fill="#94a3b8"/><rect x="764" y="256" width="62" height="48" rx="8" fill="#a8b5c6"/>
        <circle cx="782" cy="276" r="7" fill="#fff"/><circle cx="782" cy="276" r="4" fill="#7c2d12"/><circle cx="806" cy="284" r="6" fill="#fef3c7" stroke="#d97706"/>
        ${plant(474, 306)}`,
      server: `
        ${[0, 1, 2, 3, 4].map(i => rack(880 + i * 72, 44, 62, 118)).join('')}
        <path d="M884 176 H1236" stroke="#475569" stroke-width="6" stroke-dasharray="2 10" stroke-linecap="round"/>
        <rect x="1010" y="204" width="130" height="30" rx="5" fill="#4b5563"/><rect x="1013" y="207" width="124" height="24" rx="4" fill="#5b6576"/>
        ${monitor(1040, 168, 70, 36, { screen: '#03140b', code: true, colors: ['#4ade80', '#22c55e', '#86efac'], glow: '#22c55e' })}
        <rect x="1200" y="214" width="38" height="104" rx="5" fill="#cbd5e1"/>${[0, 1, 2, 3, 4, 5, 6].map(i => `<rect x="1206" y="${222 + i * 13}" width="26" height="4" rx="2" fill="#94a3b8"/>`).join('')}
        <path d="M964 320 h72" stroke="#facc15" stroke-width="8" stroke-dasharray="9 9"/>
        ${chair(1075, 258, '#1f2937', '#111827')}`,
      search: `
        <ellipse cx="98" cy="626" rx="30" ry="8" fill="#7c4a22"/><rect x="94" y="596" width="8" height="30" fill="#92582a"/>
        <circle cx="98" cy="552" r="44" fill="#3b82f6"/>
        <g clip-path="url(#globeClip)"><g class="globe-land">
          ${[0, 120].map(o => `<path d="M${60 + o} 530 q14 -14 30 -6 q10 10 -4 20 q-16 6 -20 20 q-10 -14 -6 -34z" fill="#34d399"/><path d="M${112 + o} 552 q18 -6 26 8 q4 18 -14 24 q-14 -8 -12 -32z" fill="#34d399"/><path d="M${150 + o} 520 q16 -4 22 10 q-10 8 -22 -10z" fill="#34d399"/>`).join('')}
        </g></g>
        <ellipse cx="98" cy="552" rx="18" ry="44" fill="none" stroke="#dbeafe" stroke-opacity=".45"/><path d="M54 552 h88 M60 532 h76 M60 572 h76" stroke="#dbeafe" stroke-opacity=".35"/>
        <circle cx="98" cy="552" r="44" fill="none" stroke="#1e3a8a" stroke-width="2"/><circle cx="82" cy="536" r="11" fill="#fff" opacity=".22"/>
        <path d="M48 584 A 54 54 0 0 0 150 516" stroke="#b45309" stroke-width="4" fill="none" stroke-linecap="round"/>
        <rect x="148" y="566" width="156" height="42" rx="6" fill="#b6c2cf"/><rect x="151" y="569" width="150" height="36" rx="5" fill="#cfd8e2"/>
        ${monitor(156, 520, 66, 44, { screen: '#e0f2fe', browser: true, glow: '#2dd4bf' })}${monitor(230, 520, 66, 44, { screen: '#e0f2fe', browser: true })}
        <rect x="190" y="584" width="50" height="8" rx="2" fill="#e2e8f0" stroke="#94a3b8" stroke-width=".8"/>
        ${chair(225, 640, '#0f766e', '#115e59')}
        <circle class="radar" cx="386" cy="700" r="26" fill="none" stroke="#14b8a6" stroke-width="2.5"/><circle class="radar" cx="386" cy="700" r="26" fill="none" stroke="#14b8a6" stroke-width="2.5" style="animation-delay:1.3s"/>
        <ellipse cx="386" cy="716" rx="20" ry="8" fill="#94a3b8"/><rect x="382" y="700" width="8" height="16" fill="#64748b"/>
        <path d="M364 704 a 22 22 0 0 1 44 0 z" fill="#e2e8f0" stroke="#64748b" stroke-width="2"/><path d="M386 704 L396 684" stroke="#64748b" stroke-width="2.4"/><circle cx="396" cy="684" r="3.5" fill="#ef4444"/>
        ${plant(54, 742)}`,
      meeting: `
        <rect x="464" y="464" width="332" height="190" rx="7" fill="#cbd5e1" stroke="#94a3b8" stroke-width="3"/>
        <rect x="474" y="474" width="312" height="162" rx="3" fill="#fdfdfb"/>
        <rect x="520" y="640" width="220" height="9" rx="3" fill="#94a3b8"/>
        <rect x="540" y="636" width="18" height="5" rx="2" fill="#dc2626"/><rect x="566" y="636" width="18" height="5" rx="2" fill="#2563eb"/><rect x="592" y="636" width="18" height="5" rx="2" fill="#16a34a"/><rect x="700" y="635" width="28" height="7" rx="2" fill="#f1f5f9" stroke="#94a3b8"/>
        ${[540, 610, 680, 750].map(x => `<rect x="${x - 15}" y="672" width="30" height="16" rx="6" fill="#7c3aed" opacity=".75"/>`).join('')}
        <rect x="500" y="692" width="300" height="56" rx="16" fill="#8d5f3a"/><rect x="504" y="696" width="292" height="48" rx="13" fill="#a87447"/>
        <rect x="560" y="706" width="26" height="20" rx="2" fill="#fff" transform="rotate(-8 573 716)"/><rect x="700" y="704" width="40" height="26" rx="3" fill="#cbd5e1"/><rect x="703" y="707" width="34" height="18" rx="2" fill="#334155"/>
        <circle cx="640" cy="720" r="7" fill="#fff" stroke="#8b5cf6" stroke-width="2"/>
        ${plant(884, 742)}`,
      desk: `
        <rect x="1052" y="566" width="188" height="104" rx="18" fill="#f8c9a6" opacity=".55"/>
        <rect x="1054" y="494" width="184" height="66" rx="6" fill="#a8774b"/><rect x="1057" y="497" width="178" height="60" rx="5" fill="#c9996b"/>
        ${monitor(1106, 466, 80, 46, { screen: '#1e3a5f', code: true, colors: ['#93c5fd', '#fda4af', '#fde68a'], glow: '#fb923c' })}
        <rect x="1116" y="530" width="60" height="12" rx="2" fill="#e5e7eb" stroke="#94a3b8" stroke-width=".8"/>
        <ellipse cx="1194" cy="538" rx="5" ry="7" fill="#e5e7eb" stroke="#94a3b8" stroke-width=".8"/>
        <path class="steam" d="M1214 506 q-4 -6 0 -12 q4 -6 0 -12" stroke="#cbd5e1" stroke-width="2" fill="none"/><path class="steam" d="M1222 508 q-4 -6 0 -12" stroke="#cbd5e1" stroke-width="2" fill="none" style="animation-delay:1.2s"/>
        <circle cx="1218" cy="520" r="9" fill="#fff" stroke="#f97316" stroke-width="2.4"/><circle cx="1218" cy="520" r="5.5" fill="#7c2d12"/>
        <rect x="1070" y="526" width="28" height="22" rx="2" fill="#fef08a" transform="rotate(-6 1084 537)"/>
        ${plant(1080, 510, 0.75)}
        <circle cx="1146" cy="606" r="24" fill="#334155"/><rect x="1120" y="622" width="52" height="12" rx="6" fill="#1e293b"/>
        <g class="me">
          <ellipse cx="1124" cy="588" rx="6" ry="11" fill="#4f6bed" transform="rotate(20 1124 588)"/><ellipse cx="1168" cy="588" rx="6" ry="11" fill="#4f6bed" transform="rotate(-20 1168 588)"/>
          <circle cx="1128" cy="577" r="5" fill="#f2c9a0"/><circle cx="1164" cy="577" r="5" fill="#f2c9a0"/>
          <ellipse cx="1146" cy="608" rx="27" ry="14" fill="#4f6bed"/>
          <circle cx="1131" cy="594" r="4" fill="#f2c9a0"/><circle cx="1161" cy="594" r="4" fill="#f2c9a0"/>
          <circle cx="1146" cy="594" r="15" fill="#3b2a20"/><path d="M1136 586 q10 -8 20 0" stroke="#5a4030" stroke-width="2" fill="none"/>
        </g>
        <rect x="940" y="712" width="62" height="44" rx="5" fill="#cbd5e1"/><rect x="946" y="718" width="50" height="10" rx="2" fill="#94a3b8"/><rect x="954" y="706" width="34" height="10" fill="#fff" stroke="#e2e8f0"/>
        ${plant(946, 478, 0.8)}`,
    };

    let rooms = '';
    for (const id of ROOM_IDS) {
      const r = ROOMS[id];
      rooms += `<g class="room room-${id}" data-room="${id}">
        <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${floors[id]}"/>
        ${furniture[id]}
        <rect class="room-glow" x="${r.x + 3}" y="${r.y + 3}" width="${r.w - 6}" height="${r.h - 6}" rx="4" fill="var(--${id})" fill-opacity=".09" stroke="var(--${id})" stroke-width="5"/>
      </g>`;
    }

    const doors = ROOM_IDS.map(id => {
      const r = ROOMS[id];
      const y = r.row === 'top' ? 330 : 434;
      return `<rect x="${r.door - 38}" y="${y}" width="76" height="20" fill="#e8e3d7"/><path d="M${r.door - 38} ${y + 10} h76" stroke="#cfc7b5" stroke-width="3"/>`;
    }).join('');

    const hall = `
      <rect x="32" y="348" width="1216" height="88" fill="url(#pHall)"/>
      <rect x="150" y="383" width="980" height="18" rx="9" fill="#d9d0bd" opacity=".55"/>
      ${plant(54, 392, 0.9)}${plant(1226, 368, 0.85)}
      <g transform="translate(1146 356)"><rect x="-11" y="0" width="22" height="26" rx="4" fill="#e2e8f0" stroke="#94a3b8"/><circle cx="0" cy="-3" r="9" fill="#93c5fd" stroke="#3b82f6" stroke-width="1.5"/><rect x="-4" y="10" width="8" height="4" rx="1" fill="#3b82f6"/></g>`;

    $('floor').innerHTML = `${defs}
      <rect x="16" y="16" width="1248" height="768" rx="18" fill="#474d5f" filter="url(#shadow)"/>
      ${hall}${rooms}${doors}`;
  }

  // ───────────────────────── 화면 요소 ─────────────────────────
  const el = {
    stage: $('stage'), box: $('stageBox'), wrap: $('stageWrap'), claude: $('claude'), bubble: $('bubble'),
    sign: $('toolSign'), user: $('userBubble'), pop: $('checkPop'), feed: $('feed'), board: $('board'),
  };
  const signs = {}, statRows = {};

  function buildChrome() {
    const holder = $('signs');
    for (const id of ROOM_IDS) {
      const r = ROOMS[id];
      const d = document.createElement('div');
      d.className = 'door-sign';
      d.dataset.room = id;
      d.style.setProperty('--c', `var(--${id})`);
      d.style.top = (r.row === 'top' ? 354 : 406) + 'px';
      d.style.left = (r.signRight ? r.door + 46 : r.door - 46) + 'px';
      if (r.signRight) d.style.transform = 'none';
      d.innerHTML = `<i class="dot"></i>${r.icon} ${r.name} <small>${r.sub}</small> <b>0</b>`;
      holder.appendChild(d);
      signs[id] = d;

      const row = document.createElement('div');
      row.className = 'rs';
      row.style.setProperty('--c', `var(--${id})`);
      row.innerHTML = `<span>${r.icon} ${r.name}</span><div class="bar"><i></i></div><b>0</b>`;
      $('roomStats').appendChild(row);
      statRows[id] = row;
    }
  }

  function fit() {
    const pad = 36;
    const narrow = matchMedia('(max-width: 1100px)').matches;
    const byWidth = (el.wrap.clientWidth - pad) / W;
    const s = narrow ? byWidth : Math.min(byWidth, (el.wrap.clientHeight - pad) / H, 1.6);
    const scale = Math.max(0.3, s);
    el.stage.style.transform = `scale(${scale})`;
    el.box.style.width = W * scale + 'px';
    el.box.style.height = H * scale + 'px';
  }

  // ───────────────────────── 상태 ─────────────────────────
  class Abort extends Error {}
  const char = { x: ROOMS.desk.spot[0], y: ROOMS.desk.spot[1], room: 'desk', path: [], target: null, resolve: null, reject: null, facing: 1 };
  const queue = [];
  const pending = new Map();
  const known = new Map();
  let gen = 0, running = false, mode = 'idle';
  let turnOpen = false, lastRoom = 'desk', lastEventTs = 0, lastActivity = Date.now();
  let lastThought = '', lastSay = '', followAuto = false;
  let bubbleKind = null, bubbleAt = 0, signTool = null;
  let boardPlan = null;
  let localStats = null;
  let demo = null, es = null;

  function setMode(m, room) {
    mode = m;
    const c = el.claude.classList;
    c.remove('walk', 'work', 'think', 'error', 'ask', 'report', 'talk', 'sleep', 'idle', 'p-book', 'p-laptop', 'p-terminal', 'p-glass', 'p-marker', 'p-paper');
    c.add(m);
    if (m === 'work' && room && ROOMS[room]) c.add('p-' + ROOMS[room].prop);
  }
  function setFacing(f) {
    char.facing = f;
    el.claude.classList.toggle('left', f < 0);
  }
  let sweatTimer = 0;
  function sweat(ms) {
    el.claude.classList.add('sweating');
    clearTimeout(sweatTimer);
    sweatTimer = setTimeout(() => el.claude.classList.remove('sweating'), ms);
  }

  function showBubble(kind, html) {
    const b = el.bubble;
    const same = bubbleKind === kind && b.classList.contains('show');
    b.className = 'bubble ' + kind + (same ? ' show' : '');
    b.innerHTML = html;
    bubbleKind = kind;
    bubbleAt = Date.now();
    placeBubble();
    if (!same) {
      void b.offsetWidth; // 리플로를 강제해서 등장 전환이 다시 재생되게
      b.classList.add('show');
    }
  }
  function hideBubble() {
    el.bubble.classList.remove('show');
    bubbleKind = null;
  }
  function thinkCloud(text) {
    showBubble('think', `<i class="puff-top"></i><span class="txt">${text ? esc(text) : '생각 중<span class="dots"><i></i><i></i><i></i></span>'}</span><i class="puff p1"></i><i class="puff p2"></i>`);
  }
  function askBubble(q, options) {
    const opts = options && options.length ? `<div class="opts">${options.map(o => `<span>${esc(o)}</span>`).join('')}</div>` : '';
    showBubble('ask', `<span class="q">?</span>${esc(q)}${opts}`);
  }
  function placeBubble() {
    if (!bubbleKind) return;
    const b = el.bubble;
    const w = b.offsetWidth, h = b.offsetHeight;
    const think = bubbleKind === 'think';
    const left = clamp(char.x - w / 2, 8, W - w - 8);
    let top = char.y - 80 - h - (think ? 30 : 14);
    let below = false;
    if (top < 6) { top = char.y + (signTool ? 40 : 14) + (think ? 22 : 8); below = true; }
    b.style.left = left + 'px';
    b.style.top = top + 'px';
    b.style.setProperty('--tail-x', clamp(char.x - left, 20, w - 20) + 'px');
    b.classList.toggle('below', below);
  }

  function showSign(ev) {
    signTool = ev;
    const s = el.sign;
    s.style.setProperty('--c', `var(--${ev.room})`);
    s.className = 'tool-sign show';
    s.innerHTML = `${ev.git ? '<span class="git">git</span>' : ''}<b>${esc(ev.tool || ev.name)}</b>${ev.label ? `<span>${esc(ev.label)}</span>` : ''}<em></em>`;
  }
  function hideSign() {
    el.sign.classList.remove('show');
    signTool = null;
  }
  let popTimer = 0;
  function popCheck() {
    el.pop.classList.remove('go');
    void el.pop.offsetWidth;
    el.pop.classList.add('go');
    clearTimeout(popTimer);
    popTimer = setTimeout(() => el.pop.classList.remove('go'), 900);
  }

  let userTimer = 0;
  function userSay(text) {
    const b = el.user;
    b.innerHTML = `<span class="who">나</span>${esc(clip(text, 90))}`;
    b.style.left = '0px';
    const w = b.offsetWidth;
    const left = clamp(1146 - w / 2, 1048, 1240 - w);
    b.style.left = left + 'px';
    b.style.top = '652px';
    b.style.setProperty('--tail-x', clamp(1146 - left, 16, w - 16) + 'px');
    b.classList.add('show');
    clearTimeout(userTimer);
    userTimer = setTimeout(() => b.classList.remove('show'), 6000);
  }

  function highlight(room) {
    document.querySelectorAll('.room').forEach(g => g.classList.toggle('active', g.dataset.room === room));
    for (const id of ROOM_IDS) {
      signs[id].classList.toggle('active', id === room);
      statRows[id].classList.toggle('active', id === room);
    }
  }

  let nowState = '';
  function setNow(icon, title, sub, room, m) {
    const key = icon + title + sub + room + m;
    if (key === nowState) return;
    nowState = key;
    $('nowIcon').textContent = icon;
    $('nowTitle').textContent = title;
    $('nowSub').textContent = sub || '';
    $('now').dataset.room = room || '';
    $('now').dataset.mode = m || '';
    $('nowTime').textContent = '';
    document.title = `${icon} ${title} · Claude 사무실`;
  }

  // ───────────────────────── 화이트보드 ─────────────────────────
  function setBoard(plan, animate) {
    const prev = boardPlan;
    boardPlan = plan || null;
    const all = (plan && plan.items) || [];
    let items = all;
    if (all.length > 14) {
      const cur = Math.max(0, all.findIndex(i => i.status !== 'done'));
      const start = clamp(cur - 3, 0, all.length - 14);
      items = all.slice(start, start + 14);
    }
    el.board.classList.toggle('has-items', all.length > 0);
    el.board.dataset.size = items.length > 6 ? 'xs' : items.length > 5 ? 's' : 'm';
    $('boardTitle').textContent = plan ? plan.title || '계획' : '화이트보드';
    const done = all.filter(i => i.status === 'done').length;
    $('boardCount').textContent = all.length ? `${done}/${all.length}` : '';
    const before = new Set(((prev && prev.items) || []).map(i => i.status + '|' + i.text));
    const list = $('boardList');
    list.innerHTML = '';
    let fresh = 0;
    for (const it of items) {
      const li = document.createElement('li');
      li.className = it.status;
      li.innerHTML = `<i>${it.status === 'done' ? '✔' : it.status === 'doing' ? '▶' : '☐'}</i><span>${esc(it.text)}</span>`;
      if (animate && !before.has(it.status + '|' + it.text)) {
        li.classList.add('fresh');
        li.style.animationDelay = (fresh++ * 0.18) + 's';
      }
      list.appendChild(li);
    }
    return fresh;
  }

  // ───────────────────────── 이동 ─────────────────────────
  const inside = r => ({ x: r.door, y: r.row === 'top' ? 298 : 486 });
  function atSpot(room) {
    const s = ROOMS[room].spot;
    return char.room === room && Math.hypot(char.x - s[0], char.y - s[1]) < 2;
  }
  function routeTo(room) {
    const to = ROOMS[room];
    const spot = { x: to.spot[0], y: to.spot[1], enter: room };
    if (char.room === room) return atSpot(room) ? [] : [spot];
    const pts = [];
    const from = ROOMS[char.room];
    if (from) {
      for (const v of (from.via || []).slice().reverse()) pts.push({ x: v[0], y: v[1] });
      pts.push(inside(from), { x: from.door, y: LANE_Y, enter: null });
    } else pts.push({ x: char.x, y: LANE_Y, enter: null });
    pts.push({ x: to.door, y: LANE_Y }, { ...inside(to), enter: room });
    for (const v of to.via || []) pts.push({ x: v[0], y: v[1] });
    pts.push(spot);
    return pts;
  }
  function walkTo(room) {
    const pts = routeTo(room);
    if (!pts.length) return Promise.resolve();
    hideSign();
    setMode('walk');
    return new Promise((resolve, reject) => {
      char.path = pts;
      char.target = room;
      char.resolve = resolve;
      char.reject = reject;
    });
  }
  function teleport(room) {
    const s = ROOMS[room].spot;
    char.path = [];
    char.x = s[0];
    char.y = s[1];
    char.room = room;
    setFacing(ROOMS[room].face);
    highlight(room);
  }
  function abortAll() {
    gen++;
    char.path = [];
    const rj = char.reject;
    char.resolve = char.reject = null;
    if (rj) rj(new Abort());
  }
  function speedFactor() {
    const n = queue.length;
    return n <= 1 ? 1 : Math.min(7, 1 + (n - 1) * 0.5);
  }
  async function dwell(ms) {
    const g = gen;
    let t = 0;
    while (t < ms) {
      await sleep(40);
      if (g !== gen) throw new Abort();
      t += 40 * speedFactor();
    }
  }

  // 탭이 가려져 rAF가 멈춰도 걸음이 멈추지 않게 타이머로도 한 번씩 진행시킨다
  let lastT = performance.now();
  function frame() {
    step();
    requestAnimationFrame(frame);
  }
  setInterval(() => { if (performance.now() - lastT > 150) step(); }, 100);

  function step() {
    const t = performance.now();
    const dt = Math.min(1, (t - lastT) / 1000);
    lastT = t;
    let budget = SPEED * speedFactor() * dt;
    while (char.path.length && budget > 0) {
      const p = char.path[0];
      const dx = p.x - char.x, dy = p.y - char.y, d = Math.hypot(dx, dy);
      if (Math.abs(dx) > 0.5) setFacing(dx > 0 ? 1 : -1);
      if (d > budget) {
        char.x += (dx / d) * budget;
        char.y += (dy / d) * budget;
        break;
      }
      budget -= d;
      char.x = p.x;
      char.y = p.y;
      if ('enter' in p) char.room = p.enter;
      char.path.shift();
      if (!char.path.length) {
        char.room = char.target;
        setFacing(ROOMS[char.room].face);
        const r = char.resolve;
        char.resolve = char.reject = null;
        if (r) r();
      }
    }
    el.claude.style.transform = `translate(${(char.x - 32).toFixed(1)}px, ${(char.y - 78).toFixed(1)}px)`;
    el.sign.style.transform = `translate(calc(-50% + ${char.x.toFixed(1)}px), ${(char.y + 8).toFixed(1)}px)`;
    el.pop.style.left = (char.x + 18).toFixed(1) + 'px';
    el.pop.style.top = (char.y - 92).toFixed(1) + 'px';
    placeBubble();
  }

  // ───────────────────────── 이벤트 처리 ─────────────────────────
  function lastPending() {
    let p = null;
    for (const v of pending.values()) p = v;
    return p;
  }
  function stale() {
    return lastEventTs && Date.now() - lastEventTs > 10 * 60 * 1000;
  }
  function toolTitle(ev) {
    const t = known.get(ev.id);
    return (t && t.tool) || ev.name || '도구';
  }

  function bookkeep(ev) {
    if (ev.ts) lastEventTs = Math.max(lastEventTs, ev.ts);
    switch (ev.k) {
      case 'user': turnOpen = true; break;
      case 'think': if (ev.text) lastThought = ev.text; turnOpen = true; break;
      case 'tool':
        turnOpen = true;
        pending.set(ev.id, ev);
        known.set(ev.id, ev);
        if (known.size > 600) known.delete(known.keys().next().value);
        lastRoom = ev.room;
        break;
      case 'result': pending.delete(ev.id); break;
      case 'say': if (ev.final) { turnOpen = false; pending.clear(); lastRoom = 'desk'; } break;
      case 'turn_end': case 'interrupt': turnOpen = false; pending.clear(); break;
    }
  }

  async function perform(ev) {
    bookkeep(ev);
    lastActivity = Date.now();
    switch (ev.k) {
      case 'user':
        userSay(ev.text);
        if (bubbleKind && bubbleKind !== 'think') hideBubble();
        setMode('idle');
        setNow('🙋', '새 요청이 들어왔어요', ev.text, 'desk');
        await dwell(800);
        break;
      case 'think':
        if (!ev.text) { if (!queue.length) { setMode('think'); thinkCloud(''); } await dwell(200); break; }
        setMode('think');
        thinkCloud(ev.text);
        setNow('💭', '생각 중', ev.text, char.room, 'think');
        await dwell(2600);
        break;
      case 'tool': await doTool(ev); break;
      case 'result': await doResult(ev); break;
      case 'say': await doSay(ev); break;
      case 'turn_end':
        if (!atSpot('desk')) { hideBubble(); await walkTo('desk'); setMode('idle'); }
        break;
      case 'interrupt':
        hideSign();
        setMode('error');
        sweat(2600);
        showBubble('error', '<span class="head">✋ 중단됐어요</span><span class="msg">사용자가 작업을 멈췄어요</span>');
        setNow('✋', '사용자가 작업을 중단했어요', '', char.room, 'error');
        await dwell(2200);
        break;
      case 'compact':
        setMode('talk');
        showBubble('say', '🗜 대화가 길어져서 앞부분을 요약·정리하는 중이에요');
        setNow('🗜', '대화 압축 중', '', char.room);
        await dwell(2000);
        break;
      case 'apierr':
        setMode('error');
        sweat(3000);
        showBubble('error', `<span class="head">⚠ API 오류</span><span class="msg">${esc(ev.text)}</span>`);
        setNow('😰', 'API 오류', ev.text, char.room, 'error');
        await dwell(2800);
        break;
    }
  }

  async function doTool(ev) {
    const r = ROOMS[ev.room] || ROOMS.dev;
    const sub = `${ev.tool}${ev.label ? ' · ' + ev.label : ''}`;
    if (!atSpot(ev.room)) {
      if (bubbleKind !== 'think') hideBubble();
      highlight(ev.room);
      setNow('🚶', `${r.name}로 가는 중`, sub, ev.room);
      await walkTo(ev.room);
    }
    if (bubbleKind === 'think' || bubbleKind === 'error' || (bubbleKind && Date.now() - bubbleAt > 1500)) hideBubble();
    el.claude.classList.remove('sweating');
    highlight(ev.room);
    setMode('work', ev.room);
    showSign(ev);
    setNow(r.icon, `${r.name} · ${ev.tool}`, ev.label || ev.detail || r.sub, ev.room);
    if (ev.plan) {
      const n = setBoard(ev.plan, ev.room === 'meeting');
      if (ev.room === 'meeting') await dwell(500 + n * 180);
    }
    if (ev.ask) {
      if (ev.room !== 'desk') {
        await dwell(800);
        await walkTo('desk');
      }
      hideSign();
      highlight('desk');
      setMode('ask');
      askBubble(ev.ask, ev.options);
      setNow('❓', '물어볼 게 있어서 찾아왔어요', ev.ask, 'desk');
      await dwell(2600);
      return;
    }
    await dwell(ev.room === 'desk' ? 1500 : 950);
  }

  async function doResult(ev) {
    const mine = signTool && signTool.id === ev.id;
    if (!ev.ok) {
      if (mine) el.sign.classList.add('fail');
      setMode('error', ev.room);
      sweat(8000);
      const name = toolTitle(ev);
      showBubble('error', `<span class="head">⚠ ${esc(name)} 실패</span><span class="msg">${esc(ev.error)}</span>`);
      setNow('😰', `${name} 실패 — 식은땀 나는 중`, ev.error, ev.room || char.room, 'error');
      await dwell(2800);
      return;
    }
    if (mine) {
      el.sign.classList.add('ok');
      popCheck();
    }
    if (ev.answer) {
      userSay('답변: ' + ev.answer);
      if (bubbleKind === 'ask') hideBubble();
      setMode('idle');
      await dwell(900);
    } else if (mine) await dwell(220);
  }

  async function doSay(ev) {
    if (ev.final) {
      hideSign();
      if (!atSpot('desk')) {
        hideBubble();
        highlight('desk');
        setNow('🚶', '결과를 보고하러 가는 중', ev.text, 'desk');
        await walkTo('desk');
      }
      highlight('desk');
      setMode('report');
      showBubble('say final', `<span class="tag">완료</span>${esc(ev.text)}`);
      setNow('✅', '응답 완료 · 다음 지시를 기다려요', ev.text, 'desk');
      await dwell(clamp(1500 + ev.text.length * 22, 2600, 6000));
      return;
    }
    setMode('talk');
    showBubble('say', esc(ev.text));
    setNow('💬', '진행 상황을 말하는 중', ev.text, char.room);
    await dwell(clamp(1200 + ev.text.length * 18, 1800, 4200));
  }

  function fastForward(n) {
    for (let i = 0; i < n && queue.length; i++) {
      const ev = queue.shift();
      bookkeep(ev);
      if (ev.k === 'tool' && ev.plan) setBoard(ev.plan, false);
    }
    hideBubble();
    hideSign();
    const p = lastPending();
    teleport(p ? (p.ask ? 'desk' : p.room) : turnOpen ? lastRoom : 'desk');
  }

  async function pump() {
    if (running) return;
    running = true;
    const g = gen;
    try {
      while (queue.length && g === gen) {
        if (queue.length > 40) fastForward(queue.length - 8);
        await perform(queue.shift());
      }
    } catch (e) {
      if (!(e instanceof Abort)) console.error(e);
    } finally {
      running = false;
    }
    if (queue.length) pump();
    else rest();
  }

  // 큐 밖에서 걷기(쉬러 가기 등): 도착하면 바로 자세를 다시 잡는다
  function stroll(room) {
    walkTo(room).then(() => { setMode('idle'); rest(); }, () => {});
  }

  // 큐가 비었을 때: 지금 상태(도구 실행 중 / 생각 중 / 질문 대기 / 쉬는 중)에 맞는 자세로
  function rest() {
    if (running || char.path.length) return;
    const p = lastPending();
    const secs = s => (s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초째` : `${s}초째`);
    const since = lastEventTs ? Math.max(0, Math.round((Date.now() - lastEventTs) / 1000)) : 0;
    if (stale()) {
      turnOpen = false;
      pending.clear();
    }
    if (p && !stale()) {
      if (p.ask) {
        if (!atSpot('desk')) { stroll('desk'); return; }
        if (mode !== 'ask' || bubbleKind !== 'ask') { setMode('ask'); askBubble(p.ask, p.options); }
        setNow('❓', '내 답을 기다리고 있어요', p.ask, 'desk');
        $('nowTime').textContent = secs(Math.round((Date.now() - p.ts) / 1000));
        return;
      }
      if (!signTool || signTool.id !== p.id || mode !== 'work') {
        if (char.room !== p.room) { stroll(p.room); return; }
        setMode('work', p.room);
        showSign(p);
        highlight(p.room);
      }
      if (bubbleKind && Date.now() - bubbleAt > 4000) hideBubble();
      const r = ROOMS[p.room];
      const s = Math.round((Date.now() - p.ts) / 1000);
      setNow(r.icon, `${r.name} · ${p.tool} 실행 중`, p.label || p.detail || r.sub, p.room);
      $('nowTime').textContent = secs(s);
      const em = el.sign.querySelector('em');
      if (em) em.textContent = s >= 3 ? `${s}s` : '';
      return;
    }
    if (turnOpen) {
      // 방금 실패했다면 빨간 말풍선과 식은땀을 조금 더 보여 준다
      if (bubbleKind === 'error' && Date.now() - bubbleAt < 8000) return;
      if (mode !== 'think') setMode('think');
      if (signTool && Date.now() - bubbleAt > 1200) hideSign();
      if (bubbleKind !== 'think') thinkCloud('');
      setNow('💭', '생각 중…', lastThought || '다음에 할 일을 고민하고 있어요', char.room, 'think');
      $('nowTime').textContent = secs(since);
      return;
    }
    hideSign();
    if (!atSpot('desk')) { hideBubble(); stroll('desk'); return; }
    const idleMs = Date.now() - Math.max(lastActivity, lastEventTs || 0);
    if (idleMs > 45000) {
      if (mode !== 'sleep') { setMode('sleep'); hideBubble(); }
      setNow('😴', '쉬는 중', '지시가 오면 바로 일어나요', 'desk');
    } else {
      if (mode !== 'idle' && mode !== 'report') setMode('idle');
      if (bubbleKind && Date.now() - bubbleAt > 14000) hideBubble();
      setNow('✅', '대기 중 · 다음 지시를 기다려요', lastSay || '', 'desk');
    }
    $('nowTime').textContent = '';
    highlight('desk');
  }

  // ───────────────────────── 활동 기록 ─────────────────────────
  const feedItems = new Map();
  function feedAdd(ev) {
    let ic = '', cls = '', tx = '', room = '';
    switch (ev.k) {
      case 'user': ic = '🙋'; cls = 'user'; tx = `<b>나</b> ${esc(ev.text)}`; break;
      case 'think': if (!ev.text) return; ic = '💭'; cls = 'think'; tx = esc(ev.text); break;
      case 'say': ic = ev.final ? '✅' : '💬'; cls = 'say'; tx = esc(clip(ev.text, 160)); if (ev.final) room = 'desk'; lastSay = ev.final ? ev.text : lastSay; break;
      case 'tool': {
        const r = ROOMS[ev.room] || ROOMS.dev;
        ic = r.icon; room = ev.room;
        known.set(ev.id, ev);
        tx = `${ev.git ? '<b style="color:#f05033">git</b> ' : ''}<b>${esc(ev.tool)}</b> ${esc(ev.label || '')}<span class="st"></span><small>${esc(r.name)}${ev.detail && ev.detail !== ev.label ? ' · ' + esc(ev.detail) : ''}</small>`;
        break;
      }
      case 'result': {
        const li = feedItems.get(ev.id);
        if (li) li.classList.add(ev.ok ? 'ok' : 'fail');
        if (ev.ok && ev.answer) { ic = '🙋'; cls = 'user'; tx = `<b>나</b> 답변: ${esc(ev.answer)}`; break; }
        if (ev.ok) return;
        ic = '😰'; cls = 'err'; tx = `<b>${esc(toolTitle(ev))} 실패</b> ${esc(ev.error)}`;
        break;
      }
      case 'interrupt': ic = '✋'; cls = 'err'; tx = '사용자가 작업을 중단했어요'; break;
      case 'compact': ic = '🗜'; tx = '대화 압축(요약)'; break;
      case 'apierr': ic = '⚠'; cls = 'err'; tx = `<b>API 오류</b> ${esc(ev.text)}`; break;
      default: return;
    }
    const li = document.createElement('li');
    if (cls) li.className = cls;
    if (room) li.dataset.room = room;
    li.innerHTML = `<time>${hhmmss(ev.ts || Date.now())}</time><span class="ic">${ic}</span><div class="tx">${tx}</div>`;    if (ev.k === 'tool') feedItems.set(ev.id, li);
    el.feed.prepend(li);
    while (el.feed.children.length > 160) {
      const last = el.feed.lastElementChild;
      for (const [k, v] of feedItems) if (v === last) feedItems.delete(k);
      last.remove();
    }
  }

  function renderStats(s) {
    if (!s) return;
    const max = Math.max(1, ...ROOM_IDS.map(r => s[r] || 0));
    for (const id of ROOM_IDS) {
      const n = s[id] || 0;
      statRows[id].querySelector('i').style.width = (n / max) * 100 + '%';
      statRows[id].querySelector('b').textContent = n;
      signs[id].querySelector('b').textContent = n;
    }
    $('kTools').textContent = s.tools || 0;
    $('kErrors').textContent = s.errors || 0;
    $('kPrompts').textContent = s.prompts || 0;
  }
  function countLocal(ev) {
    if (!localStats) return;
    if (ev.k === 'tool') { localStats[ev.room]++; localStats.tools++; }
    if (ev.k === 'result' && !ev.ok) localStats.errors++;
    if (ev.k === 'user') localStats.prompts++;
    renderStats(localStats);
  }

  // ───────────────────────── 서버 연결 ─────────────────────────
  function resetAll() {
    abortAll();
    queue.length = 0;
    pending.clear();
    known.clear();
    feedItems.clear();
    el.feed.innerHTML = '';
    turnOpen = false;
    lastRoom = 'desk';
    lastEventTs = 0;
    lastThought = '';
    lastSay = '';
    hideBubble();
    hideSign();
    el.user.classList.remove('show');
    el.claude.classList.remove('sweating');
    setBoard(null, false);
    teleport('desk');
    setMode('idle');
  }

  function setSession(s, auto) {
    if (auto != null) followAuto = auto;
    auto = followAuto;
    $('empty').hidden = !!s;
    if (!s) {
      $('sessProject').textContent = '—';
      $('sessTitle').textContent = '따라갈 세션이 없어요';
      $('sessMeta').textContent = '';
      return;
    }
    if (s.project) $('sessProject').textContent = s.project;
    if (s.title) $('sessTitle').textContent = s.title;
    const model = (s.model || '').replace(/^claude-/, '');
    $('sessMeta').textContent = [model, s.branch && s.branch !== 'HEAD' ? '⎇ ' + s.branch : '', auto ? '자동 추적' : ''].filter(Boolean).join(' · ');
    if (s.file) $('sessTitle').title = s.file;
  }

  function onHello(d) {
    resetAll();
    localStats = null;
    $('emptyRoot').textContent = d.root ? `찾는 위치: ${d.root}` : '';
    setSession(d.session, d.auto);
    renderStats(d.stats);
    const hist = d.history || [];
    for (const ev of hist) {
      bookkeep(ev);
      if (ev.k === 'say' && ev.final) lastSay = ev.text;
    }
    for (const ev of hist.slice(-90)) feedAdd(ev);
    setBoard(d.plan, false);
    if (stale()) { turnOpen = false; pending.clear(); }
    const p = lastPending();
    teleport(p ? (p.ask ? 'desk' : p.room) : turnOpen ? lastRoom : 'desk');
    lastActivity = lastEventTs || Date.now();
    rest();
    highlightCurrentOption(d.session && d.session.file);
    loadSessions();
  }

  function ingest(events) {
    for (const ev of events) {
      feedAdd(ev);
      countLocal(ev);
      queue.push(ev);
    }
    pump();
  }

  function setConn(state, text) {
    $('conn').dataset.state = state;
    $('conn').querySelector('span').textContent = text;
  }

  function connect() {
    if (es) es.close();
    const file = $('sessionSelect').value || 'auto';
    es = new EventSource('/api/stream?file=' + encodeURIComponent(file));
    setConn('wait', '연결 중…');
    es.onopen = () => setConn('live', '실시간 · 0.25초 간격');
    es.onerror = () => setConn('off', '재연결 중…');
    es.addEventListener('hello', e => { setConn('live', '실시간 · 0.25초 간격'); onHello(JSON.parse(e.data)); });
    es.addEventListener('events', e => {
      const d = JSON.parse(e.data);
      if (d.meta) setSession({ ...d.meta }, null);
      ingest(d.events || []);
      renderStats(d.stats);
    });
  }

  // ───────────────────────── 세션 목록 ─────────────────────────
  function ago(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 45) return '방금';
    if (s < 3600) return `${Math.round(s / 60)}분 전`;
    if (s < 86400) return `${Math.round(s / 3600)}시간 전`;
    return `${Math.round(s / 86400)}일 전`;
  }
  let followed = '';
  function highlightCurrentOption(file) {
    followed = file || '';
    const opt = $('sessionSelect').querySelector('option[value="auto"]');
    if (opt) opt.textContent = '자동 · 가장 최근 세션';
  }
  async function loadSessions() {
    let d;
    try { d = await (await fetch('/api/sessions')).json(); } catch { return; }
    const sel = $('sessionSelect');
    const keep = sel.value;
    sel.innerHTML = '<option value="auto">자동 · 가장 최근 세션</option>';
    for (const s of d.sessions || []) {
      const o = document.createElement('option');
      o.value = s.file;
      o.textContent = `${s.file === followed ? '● ' : ''}${s.project} — ${clip(s.title, 34)} · ${ago(s.mtime)}`;
      sel.appendChild(o);
    }
    if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
  }

  // ───────────────────────── 데모 ─────────────────────────
  const DEMO = [
    [300, { k: 'user', text: '로그인하면 가끔 401이 떠요. 원인 찾아서 고쳐줘' }],
    [1600, { k: 'think', text: '토큰 만료 처리 쪽이 의심된다. 먼저 인증 미들웨어부터 읽어 보자' }],
    [2900, { k: 'tool', id: 'd1', name: 'TodoWrite', tool: 'TodoWrite', room: 'meeting', label: '할 일 4개 정리', plan: { title: '할 일', items: [{ text: '인증 흐름 파악', status: 'doing' }, { text: '401 재현 테스트 작성', status: 'todo' }, { text: '토큰 갱신 로직 수정', status: 'todo' }, { text: '테스트 통과 후 커밋', status: 'todo' }] } }],
    [400, { k: 'result', id: 'd1', ok: true }],
    [600, { k: 'tool', id: 'd2', name: 'Grep', tool: 'Grep', room: 'library', label: '"verifyToken" · src' }],
    [900, { k: 'result', id: 'd2', ok: true }],
    [300, { k: 'tool', id: 'd3', name: 'Read', tool: 'Read', room: 'library', label: 'auth.middleware.ts' }],
    [1100, { k: 'result', id: 'd3', ok: true }],
    [400, { k: 'think', text: '만료 1분 전 갱신 조건이 >= 가 아니라 > 로 되어 있다' }],
    [2800, { k: 'say', text: '원인 후보를 찾았어요. 만료 직전 경계값 처리 문제로 보여요.' }],
    [2600, { k: 'tool', id: 'd4', name: 'Edit', tool: 'Edit', room: 'dev', label: 'auth.middleware.ts' }],
    [1300, { k: 'result', id: 'd4', ok: true }],
    [300, { k: 'tool', id: 'd5', name: 'PowerShell', tool: 'PowerShell', room: 'server', label: 'npm test', detail: 'npm test -- auth' }],
    [2600, { k: 'result', id: 'd5', ok: false, error: 'Exit code 1 · FAIL auth.spec.ts › refresh: expected 200, received 401' }],
    [3200, { k: 'think', text: '테스트의 시계 고정값도 같이 바꿔야 하네' }],
    [2600, { k: 'tool', id: 'd6', name: 'Edit', tool: 'Edit', room: 'dev', label: 'auth.spec.ts' }],
    [1000, { k: 'result', id: 'd6', ok: true }],
    [300, { k: 'tool', id: 'd7', name: 'PowerShell', tool: 'PowerShell', room: 'server', label: 'npm test', detail: 'npm test -- auth' }],
    [2400, { k: 'result', id: 'd7', ok: true }],
    [300, { k: 'tool', id: 'd8', name: 'WebSearch', tool: 'WebSearch', room: 'search', label: 'JWT clock skew best practice' }],
    [1800, { k: 'result', id: 'd8', ok: true }],
    [300, { k: 'tool', id: 'd9', name: 'mcp__ccd_turn__update_plan', tool: 'update_plan', room: 'meeting', label: '진행 상황 갱신', plan: { title: '할 일', items: [{ text: '인증 흐름 파악', status: 'done' }, { text: '401 재현 테스트 작성', status: 'done' }, { text: '토큰 갱신 로직 수정', status: 'done' }, { text: '테스트 통과 후 커밋', status: 'doing' }] } }],
    [500, { k: 'result', id: 'd9', ok: true }],
    [300, { k: 'tool', id: 'd10', name: 'AskUserQuestion', tool: 'AskUserQuestion', room: 'desk', label: '커밋 메시지를 어떻게 할까요?', ask: '바로 커밋할까요, 아니면 PR로 올릴까요?', options: ['바로 커밋', 'PR로 올리기'] }],
    [4200, { k: 'result', id: 'd10', ok: true, answer: '바로 커밋' }],
    [900, { k: 'tool', id: 'd11', name: 'PowerShell', tool: 'PowerShell', room: 'server', label: 'git commit -m "fix: 토큰 만료 경계값"', git: true }],
    [1500, { k: 'result', id: 'd11', ok: true }],
    [500, { k: 'think', text: '' }],
    [1400, { k: 'say', final: true, text: '401 원인은 토큰 만료 경계값 비교(> → >=)였어요. 수정하고 테스트 통과 후 커밋까지 끝냈어요.' }],
  ];

  function startDemo() {
    stopDemo(false);
    if (es) { es.close(); es = null; }
    resetAll();
    localStats = { library: 0, dev: 0, server: 0, search: 0, meeting: 0, desk: 0, tools: 0, errors: 0, prompts: 0 };
    renderStats(localStats);
    setSession({ project: '데모', title: '예시 작업을 재생하는 중이에요', model: '' }, false);
    $('empty').hidden = true;
    setConn('demo', '데모 재생 중');
    demo = [];
    let t = 0;
    for (const [d, ev] of DEMO) {
      t += d;
      demo.push(setTimeout(() => ingest([{ ...ev, ts: Date.now() }]), t));
    }
    demo.push(setTimeout(() => stopDemo(true), t + 9000));
    $('demoBtn').textContent = '데모 끝내기';
    $('demoBtn').classList.add('stop');
  }
  function stopDemo(reconnect) {
    if (!demo) return;
    demo.forEach(clearTimeout);
    demo = null;
    $('demoBtn').textContent = '데모 보기';
    $('demoBtn').classList.remove('stop');
    if (reconnect) connect();
  }

  // ───────────────────────── 시작 ─────────────────────────
  buildFloor();
  buildChrome();
  fit();
  new ResizeObserver(fit).observe(el.wrap);
  teleport('desk');
  setMode('idle');
  requestAnimationFrame(frame);
  setInterval(() => { if (!running) rest(); }, 500);

  const sel = $('sessionSelect');
  try { const saved = localStorage.getItem('claude-office-session'); if (saved) { const o = document.createElement('option'); o.value = saved; o.textContent = saved; sel.appendChild(o); sel.value = saved; } } catch { /* 저장소 없음 */ }
  sel.addEventListener('change', () => {
    try { localStorage.setItem('claude-office-session', sel.value === 'auto' ? '' : sel.value); } catch { /* 저장소 없음 */ }
    stopDemo(false);
    connect();
  });
  $('demoBtn').addEventListener('click', () => (demo ? stopDemo(true) : startDemo()));
  loadSessions().then(() => {
    try { const saved = localStorage.getItem('claude-office-session'); if (saved && [...sel.options].some(o => o.value === saved)) sel.value = saved; else sel.value = 'auto'; } catch { sel.value = 'auto'; }
    // ?demo 로 열면 실제 세션 대신 데모부터 재생하고, 끝나면 실시간 추적으로 넘어간다
    if (new URLSearchParams(location.search).has('demo')) startDemo();
    else connect();
  });
  setInterval(loadSessions, 15000);

  // 콘솔에서 이벤트를 직접 넣어 볼 수 있게 (예: officeDebug.ingest([{k:'think', text:'테스트'}]))
  window.officeDebug = {
    ingest: evs => ingest(evs.map(e => ({ ts: Date.now(), ...e }))),
    state: () => ({ x: char.x, y: char.y, room: char.room, mode, queue: queue.length, pending: [...pending.keys()], turnOpen, bubbleKind }),
  };
})();
