// 권한 확인 대기·대화 압축 중을 알려 주는 hooks가 켜져 있는지 켤 때 한 번 보고, --install-hooks로 넣어 준다.
// 사용자 설정(~/.claude/settings.json)만 본다. 프로젝트마다 켠 플러그인은 모르니, 안내는 '켜 두었다면 괜찮아요'처럼 부드럽게 한다.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCmd } = require('./config');

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

// 이 폴더의 hooks/notify.js를 가리키는 hooks 설정 (플러그인용 hooks.json의 ${CLAUDE_PLUGIN_ROOT}를 이 폴더로)
function ourHooks(root) {
  const text = fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8').split('${CLAUDE_PLUGIN_ROOT}').join(JSON.stringify(root).slice(1, -1));
  return JSON.parse(text).hooks;
}

const isPlugin = (claudeDir, root) => path.resolve(root).startsWith(path.resolve(claudeDir, 'plugins') + path.sep);
const isNpx = root => /[\\/]_npx[\\/]/.test(root);

// 설정에 사무실 hooks를 넣는다. 예전에 넣은 사무실 hook(mine(경로)가 참)은 빼고 새로 넣고, 다른 hook은 그대로 둔다.
function mergeHooks(settings, ours, mine) {
  const out = { ...settings, hooks: { ...((settings && settings.hooks) || {}) } };
  for (const [name, groups] of Object.entries(out.hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = [];
    for (const g of groups) {
      if (!g || !Array.isArray(g.hooks)) { kept.push(g); continue; }
      const hooks = g.hooks.filter(h => !mine(notifyPath(h)));
      if (hooks.length || !g.hooks.length) kept.push(hooks.length === g.hooks.length ? g : { ...g, hooks });
    }
    if (kept.length) out.hooks[name] = kept;
    else delete out.hooks[name];
  }
  for (const [name, groups] of Object.entries(ours)) out.hooks[name] = [...(out.hooks[name] || []), ...groups];
  return out;
}

// --install-hooks: ~/.claude/settings.json에 넣는다. 전 내용은 settings.json.before-claude-office로 남긴다.
// → { ok, text } (터미널에 보여 줄 말)
function installHooks(claudeDir, root) {
  if (isPlugin(claudeDir, root)) return { ok: true, text: '  ✅ 플러그인으로 켠 사무실은 hooks가 이미 켜져 있어요' };
  if (isNpx(root)) return { ok: false, text: '  ⚠ npx로 실행하면 내려받은 위치가 매번 바뀌어서 hooks를 넣을 수 없어요. 플러그인으로 설치해 주세요 (README의 방법 D)' };
  const file = path.join(claudeDir, 'settings.json');
  let settings = {};
  if (fs.existsSync(file)) {
    try {
      settings = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('설정이 객체가 아니에요');
    } catch (e) {
      return { ok: false, text: `  ⚠ ${file}을 읽지 못해서 건드리지 않았어요 (${e.message}).\n    --print-hooks로 나온 내용을 직접 합쳐 주세요` };
    }
  }
  const mineFile = path.join(root, 'hooks', 'notify.js');
  const mine = f => !!f && (path.resolve(f) === mineFile || /claude-office/i.test(f));
  const next = mergeHooks(settings, ourHooks(root), mine);
  fs.mkdirSync(claudeDir, { recursive: true });
  const backup = file + '.before-claude-office';
  if (fs.existsSync(file)) fs.copyFileSync(file, backup);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return {
    ok: true,
    text: `  ✅ ${file}에 사무실 hooks(${Object.keys(ourHooks(root)).join('·')})를 넣었어요.${fs.existsSync(backup) ? `\n     전 내용은 ${path.basename(backup)}에 남겨 뒀어요.` : ''}\n     켜져 있는 Claude Code는 다시 켜야 적용돼요.`,
  };
}

// --uninstall-hooks: 넣어 둔 사무실 hooks만 뺀다 (다른 hooks·설정은 그대로, 전 내용은 settings.json.before-claude-office로)
function uninstallHooks(claudeDir, root) {
  const file = path.join(claudeDir, 'settings.json');
  if (!fs.existsSync(file)) return { ok: true, text: '  ℹ 넣어 둔 사무실 hooks가 없어요' };
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('설정이 객체가 아니에요');
  } catch (e) {
    return { ok: false, text: `  ⚠ ${file}을 읽지 못해서 건드리지 않았어요 (${e.message})` };
  }
  const mineFile = path.join(root, 'hooks', 'notify.js');
  const mine = f => !!f && (path.resolve(f) === mineFile || /claude-office/i.test(f));
  const next = mergeHooks(settings, {}, mine);
  if (!Object.keys(next.hooks).length) delete next.hooks; // hooks가 사무실 것뿐이었으면 칸째 뺀다
  if (JSON.stringify(next) === JSON.stringify(settings)) return { ok: true, text: '  ℹ 넣어 둔 사무실 hooks가 없어요' };
  const backup = file + '.before-claude-office';
  fs.copyFileSync(file, backup);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return { ok: true, text: `  ✅ ${file}에서 사무실 hooks를 뺐어요. 다른 hooks와 설정은 그대로예요.\n     전 내용은 ${path.basename(backup)}에 남겨 뒀어요. 켜져 있는 Claude Code는 다시 켜야 적용돼요.` };
}

// 터미널·도움말 창에 보여 줄 hooks 상태: { state, text, cmd } (cmd: 고치려면 실행할 명령, 없으면 '')
// heard: 이번에 켠 뒤로 hook 알림을 받은 적이 있다 (프로젝트 설정 등 내가 못 보는 곳에서 켰을 수도 있으니 켜진 걸로 본다)
// absolute: 명령을 전체 경로로 (화면에 보여 줄 때는 어느 폴더에서 칠지 모르니까)
function hooksInfo(claudeDir, root, heard = false, absolute = false) {
  const INSTALL = runCmd('--install-hooks', absolute);
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8')); } catch { /* 없거나 못 읽으면 빈 설정 */ }
  let want = [];
  try { want = Object.keys(ourHooks(root)); } catch { return { state: 'unknown', text: '', cmd: '' }; }
  const st = hooksStatus({ settings, want, plugin: isPlugin(claudeDir, root) });
  if (st.state === 'off' && !heard) {
    return isNpx(root)
      ? { state: 'off', text: '권한 확인 대기·대화 압축 중까지 보려면 플러그인으로 설치해 주세요 (README의 방법 D)', cmd: '' }
      : { state: 'off', text: '권한 확인 대기·대화 압축 중까지 보려면 hooks를 켜 주세요 (플러그인으로 켜 두었다면 괜찮아요)', cmd: INSTALL };
  }
  if (st.state === 'stale') return { state: 'stale', text: `hooks 설정에 ${st.missing.join('·')}가 빠져 있어요. 다시 넣어 주세요`, cmd: INSTALL };
  if (st.state === 'moved') return { state: 'moved', text: `hooks가 가리키는 ${st.file}가 없어요 (폴더를 옮겼나요?). 다시 넣어 주세요`, cmd: INSTALL };
  return { state: 'on', text: 'hooks가 켜져 있어요. 권한 확인 대기·대화 압축 중도 보여 줘요', cmd: '' };
}

// 켤 때 터미널에 보여 줄 안내 한 줄 (괜찮으면 '')
function hooksHint(claudeDir, root) {
  const h = hooksInfo(claudeDir, root);
  if (h.state === 'on' || h.state === 'unknown') return '';
  return `  ${h.state === 'off' ? '🔌' : '⚠'} ${h.text}${h.cmd ? `: ${h.cmd}` : ''}`;
}

module.exports = { hooksStatus, hooksInfo, hooksHint, ourHooks, mergeHooks, installHooks, uninstallHooks };
