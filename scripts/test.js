#!/usr/bin/env node
// npm test: test/ 폴더의 *.test.js만 돌린다.
// 그냥 'node --test'는 저장소 안의 모든 폴더를 뒤져서, 안에 저장소 사본(예: 복제해 둔 claude-office/)이 있으면
// 그 사본의 예전 테스트까지 돌았다(198개 → 387개, 사본의 서버까지 띄운다).
// 'node --test test/'는 Node 버전에 따라 폴더를 받지 않고, 'test/*.test.js'를 셸에 맡기면 Windows에서 펼쳐지지 않아서
// 파일 목록을 직접 넘긴다. npm test -- --test-name-pattern=… 처럼 붙인 옵션은 그대로 node --test에 넘긴다.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.join(__dirname, '..', 'test');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort().map(f => path.join(dir, f));
const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
process.exit(r.status == null ? 1 : r.status);
