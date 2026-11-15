// 화면 쪽 파일 중 app.js·alerts.js·journal.js·demo.js·boot.js는 화면(DOM)이 있어야 돌아서 다른 테스트가 읽지 않는다.
// 거기에 문법 오류가 있거나 다른 파일에서 없는 이름을 가져오면 브라우저에서 화면이 통째로 안 뜨는데 npm test는 통과한다.
// 그래서 (1) 모든 화면 파일이 문법 오류 없이 읽히는지, (2) import { … }로 가져오는 이름이 그 파일에 정말 export돼 있는지 본다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PUBLIC = path.join(__dirname, '..', 'public');
const files = [path.join(PUBLIC, 'app.js'), ...fs.readdirSync(path.join(PUBLIC, 'js')).filter(f => f.endsWith('.js')).map(f => path.join(PUBLIC, 'js', f))];
const rel = f => path.relative(PUBLIC, f);

test('화면 파일이 모두 문법 오류 없이 읽힌다', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-syntax-'));
  try {
    for (const f of files) {
      // 브라우저에서는 모듈로 읽으니 .mjs로 옮겨 놓고 읽기만 해 본다 (import는 따라가지 않는다)
      const copy = path.join(tmp, rel(f).replace(/[\\/]/g, '_') + '.mjs');
      fs.copyFileSync(f, copy);
      try { execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' }); } catch (e) {
        assert.fail(`${rel(f)}: ${String(e.stderr).split('\n').find(l => /Error/.test(l)) || e.message}`);
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 그 파일이 내보내는 이름: export function/const/let/class 이름, export { a, b as c }
function exportsOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  // export const A = 1, B = 2; 처럼 한 줄에 여럿: 그 줄에서 '이름 ='꼴을 모두 (괄호·따옴표 안은 거의 없어서 이걸로 충분하다)
  for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+([^\n]+)/gm)) {
    for (const d of m[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*=/g)) out.add(d[1]);
  }
  for (const m of src.matchAll(/^export\s*\{([^}]+)\}/gm)) for (const part of m[1].split(',')) out.add(part.trim().split(/\s+as\s+/).pop());
  return out;
}

test('import { … }로 가져오는 이름이 그 파일에 정말 있다', () => {
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.{1,2}\/[^']+)'/g)) {
      const target = path.resolve(path.dirname(f), m[2]);
      if (!fs.existsSync(target)) { bad.push(`${rel(f)}: ${m[2]} 파일이 없어요`); continue; }
      const have = exportsOf(target);
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0];
        if (name && !have.has(name)) bad.push(`${rel(f)}: ${m[2]}에 ${name}이(가) 없어요`);
      }
    }
  }
  assert.deepEqual(bad, []);
});
