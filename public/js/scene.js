// 사무실 바닥 그림과 방 정의. 모든 층이 같은 배치를 쓴다.
export const W = 1280, H = 800, LANE_Y = 392, SPEED = 430;

// 방 정의: spot = 일하는 자리(발 위치), door = 복도 쪽 문 x, via = 문과 자리 사이 경유점, face = 도착 시 바라보는 방향
export const ROOMS = {
  library: { name: '자료실', icon: '📚', sub: '읽기·검색', x: 32, y: 32, w: 400, h: 300, door: 330, row: 'top', spot: [190, 268], prop: 'book', face: 1 },
  dev: { name: '개발실', icon: '💻', sub: '코드 수정', x: 448, y: 32, w: 400, h: 300, door: 648, row: 'top', spot: [648, 214], prop: 'laptop', face: 1 },
  server: { name: '서버실', icon: '🖥️', sub: '명령·git', x: 864, y: 32, w: 384, h: 300, door: 1000, row: 'top', spot: [1075, 268], prop: 'terminal', face: 1 },
  search: { name: '정보 검색실', icon: '🌐', sub: '웹·MCP', x: 32, y: 452, w: 400, h: 316, door: 330, row: 'bottom', spot: [225, 684], via: [[330, 664]], prop: 'glass', face: -1 },
  meeting: { name: '회의실', icon: '🗂️', sub: '계획', x: 448, y: 452, w: 460, h: 316, door: 850, row: 'bottom', spot: [834, 652], prop: 'marker', face: -1 },
  desk: { name: '내 자리', icon: '🙋', sub: '질문·보고', x: 924, y: 452, w: 324, h: 316, door: 1000, row: 'bottom', spot: [1008, 654], prop: 'paper', face: 1, signRight: true },
};
export const ROOM_IDS = Object.keys(ROOMS);

// 한 방에 여러 명이 들어오면 서는 자리 (발 위치). 첫 자리가 원래 spot이다.
const SLOTS = {
  library: [[190, 268], [252, 274], [128, 274], [221, 226], [159, 226], [300, 300]],
  dev: [[648, 214], [710, 222], [586, 222], [648, 268], [710, 276], [586, 276]],
  server: [[1075, 268], [1013, 276], [1137, 276], [1044, 318], [1106, 318], [1170, 232]],
  search: [[225, 684], [287, 690], [163, 690], [256, 736], [194, 736], [318, 736]],
  meeting: [[834, 652], [876, 700], [876, 604], [834, 750], [786, 754], [740, 754]],
  desk: [[1008, 654], [962, 704], [1056, 710], [962, 604], [1008, 752], [1104, 752]],
};
export function slotPoint(room, i) {
  const s = SLOTS[room];
  const p = s[i % s.length];
  const extra = Math.floor(i / s.length); // 자리가 모자라면 조금씩 비켜 선다
  return { x: p[0] + extra * 14, y: p[1] + extra * 6 };
}
// 방 안쪽, 문 바로 앞
export const doorInside = r => ({ x: r.door, y: r.row === 'top' ? 298 : 486 });

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

export function buildFloor(svg) {
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

  svg.innerHTML = `${defs}
    <rect x="16" y="16" width="1248" height="768" rx="18" fill="#474d5f" filter="url(#shadow)"/>
    ${hall}${rooms}${doors}`;
}
