// 권한 확인 대기·대화 압축 중을 알려 주는 hooks가 켜져 있는지, 켤 때 한 번 본다.
// 사용자 설정(~/.claude/settings.json)만 본다. 프로젝트마다 켠 플러그인은 모르니, 안내는 '켜 두었다면 괜찮아요'처럼 부드럽게 한다.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// hook 하나가 가리키는 notify.js 경로 (args에 있거나, 명령 한 줄 안에 따옴표로 있거나 그냥 있거나)
const NOTIFY = /hooks[\\/]notify\.js$/;
function notifyPath(h) {
  if (!h || typeof h !== 'object') return '';
  for (const a of Array.isArray(h.args) ? h.args : []) if (typeof a === 'string' && NOTIFY.test(a)) return a;
  const m = typeof h.command === 'string' && h.command.match(/"([^"]*hooks[\\/]notify\.js)"|'([^']*hooks[\\/]notify\.js)'|(\S*hooks[\\/]notify\.js)/);
  return m ? m[1] || m[2] || m[3] : '';
}
// ~나 $HOME은 풀어서 보고, 다른 환경 변수가 든 경로는 있는지 알 수 없으니 있다고 본다
function fileThere(f, exists) {
  const p = f.replace(/^(~|\$HOME|\$\{HOME\})(?=[\\/])/, os.homedir());
  return /\$/.test(p) || exists(p);
}

// settings: 설정 내용 · want: 있어야 할 hook 이름들 · exists: 파일이 있는지 · plugin: 플러그인으로 켠 사무실인지
// → { state: 'on'|'off'|'stale'|'moved', missing: [...], file }
function hooksStatus({ settings, want, exists = fs.existsSync, plugin = false }) {
  if (plugin) return { state: 'on', missing: [] };
  const found = new Map(); // hook 이름 → notify.js 경로
  const hooks = settings && typeof settings.hooks === 'object' ? settings.hooks : {};
  for (const [name, groups] of Object.entries(hooks || {})) {
    for (const g of Array.isArray(groups) ? groups : []) {
      for (const h of (g && Array.isArray(g.hooks)) ? g.hooks : []) {
        const f = notifyPath(h);
        if (f) found.set(name, f);
      }
    }
  }
  if (!found.size) {
    const on = Object.entries((settings && settings.enabledPlugins) || {}).some(([k, v]) => /^office@/.test(k) && v);
    return { state: on ? 'on' : 'off', missing: [] };
  }
  const gone = [...found.values()].find(f => !fileThere(f, exists));
  if (gone) return { state: 'moved', missing: [], file: gone };
  const missing = want.filter(w => !found.has(w));
  return { state: missing.length ? 'stale' : 'on', missing };
}

// 켤 때 터미널에 보여 줄 안내 한 줄 (괜찮으면 '')
function hooksHint(claudeDir, root) {
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8')); } catch { /* 없거나 못 읽으면 빈 설정 */ }
  let want = [];
  try { want = Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8')).hooks); } catch { return ''; }
  const plugin = path.resolve(root).startsWith(path.resolve(claudeDir, 'plugins') + path.sep);
  const st = hooksStatus({ settings, want, plugin });
  const npx = /[\\/]_npx[\\/]/.test(root);
  if (st.state === 'off') {
    return npx
      ? '  🔌 권한 확인 대기·대화 압축 중까지 보려면 플러그인으로 설치해 주세요 (README의 방법 D)'
      : '  🔌 권한 확인 대기·대화 압축 중까지 보려면 hooks를 켜 주세요: node server.js --print-hooks (플러그인으로 켜 두었다면 괜찮아요)';
  }
  if (st.state === 'stale') return `  ⚠ hooks 설정에 ${st.missing.join('·')}가 빠져 있어요. --print-hooks로 나온 내용을 다시 합쳐 주세요`;
  if (st.state === 'moved') return `  ⚠ hooks가 가리키는 ${st.file}가 없어요 (폴더를 옮겼나요?). --print-hooks로 나온 내용을 다시 합쳐 주세요`;
  return '';
}

module.exports = { hooksStatus, hooksHint };
