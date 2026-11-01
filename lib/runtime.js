// 켜져 있는 Claude 사무실 서버를 찾는 방법. server.js가 켜질 때 포트와 토큰을 사용자 전용 임시 파일에 적어 두고,
// hooks/notify.js와 `--stop`·`--background`가 그 파일을 읽어 서버에 요청을 보낸다.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const UID = typeof process.getuid === 'function' ? process.getuid() : null;
const userTag = () => {
  try { return os.userInfo().username.replace(/[^\w.-]/g, '_'); } catch { return 'user'; }
};
// 테스트처럼 따로 띄울 때는 CLAUDE_OFFICE_RUNTIME으로 다른 파일을 쓰게 할 수 있다
const FILE = process.env.CLAUDE_OFFICE_RUNTIME || path.join(os.tmpdir(), `claude-office-${UID != null ? UID : userTag()}.json`);
// 뒤에서 켠 서버(--background)의 출력이 쌓이는 곳. 켜지 못했을 때 이유를 보여 준다.
const LOG = FILE.replace(/\.json$/, '') + '.log';

function read() {
  try {
    // 여러 사람이 같이 쓰는 /tmp에서는 다른 사용자가 만든 파일을 믿지 않는다
    if (UID != null && fs.statSync(FILE).uid !== UID) return null;
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return d && Number(d.port) && typeof d.token === 'string' ? d : null;
  } catch {
    return null;
  }
}

function write(d) {
  try { fs.unlinkSync(FILE); } catch { /* 없던 파일 */ }
  fs.writeFileSync(FILE, JSON.stringify(d), { mode: 0o600, flag: 'wx' });
}

// 내가 쓴 파일일 때만 지운다 (같은 포트로 두 번 켰다가 실패한 쪽이 지우지 않게)
function remove(pid) {
  const d = read();
  if (d && d.pid === pid) try { fs.unlinkSync(FILE); } catch { /* 이미 지워짐 */ }
}

// 서버에 요청을 보낸다. 연결 실패·시간 초과면 null.
function request(port, method, pathname, { token, body, timeout = 1500 } = {}) {
  return new Promise(resolve => {
    const headers = {};
    if (token) headers['X-Office-Token'] = token;
    if (body != null) Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers, timeout }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end(body == null ? undefined : body);
  });
}

// 그 포트에 떠 있는 게 Claude 사무실이면 상태 정보를, 아니면 null
async function health(port) {
  const r = await request(port, 'GET', '/api/health', { timeout: 1000 });
  try {
    const d = r && r.status === 200 && JSON.parse(r.data);
    return d && d.app === 'claude-office' ? d : null;
  } catch {
    return null;
  }
}

module.exports = { FILE, LOG, read, write, remove, request, health };
