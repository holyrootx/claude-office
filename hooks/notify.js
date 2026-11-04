#!/usr/bin/env node
// Claude Code hook → Claude 사무실 서버. 권한 확인 창이 떴다는 것처럼 세션 기록 파일에 남지 않는 일을 알려 준다.
// 사무실이 꺼져 있거나 응답이 느려도 Claude Code를 방해하지 않게, 무슨 일이 있어도 조용히 exit 0으로 끝난다.
'use strict';

const runtime = require('../lib/runtime');

const KEEP = ['session_id', 'transcript_path', 'hook_event_name', 'tool_name', 'agent_id', 'notification_type', 'message', 'reason', 'trigger'];
const done = () => process.exit(0);
const guard = setTimeout(done, 3000);

// 파일 내용처럼 긴 값은 빼고 보낸다 (사무실은 표지판에 쓸 짧은 정보만 필요하다)
function slim(input) {
  const out = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (typeof v === 'string') out[k] = v.length > 2000 ? v.slice(0, 2000) : v;
    else if (JSON.stringify(v).length <= 4000) out[k] = v;
  }
  return out;
}

async function send(raw) {
  const rt = runtime.read();
  if (!rt) return; // 사무실이 꺼져 있다
  const h = JSON.parse(raw);
  const body = {};
  for (const k of KEEP) if (h[k] != null) body[k] = h[k];
  if (h.tool_input) body.tool_input = slim(h.tool_input);
  body.ppid = process.ppid; // 이 hook을 띄운 Claude Code (꺼지면 사무실이 기다림을 지운다)
  await runtime.request(rt.port, 'POST', '/hook', { token: rt.token, body: JSON.stringify(body) });
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { raw += c; });
process.stdin.on('end', () => send(raw).catch(() => {}).finally(() => { clearTimeout(guard); done(); }));
process.stdin.on('error', done);
