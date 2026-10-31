// 세션 기록(jsonl) 한 줄 한 줄을 화면용 이벤트로 바꾸는 부분을 실제 기록 모양으로 확인한다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Normalizer, roomOf, labelOf, displayName, planFromMarkdown } = require('../server.js');

let n = 0;
const ts = '2026-10-25T01:00:00.000Z';
const line = o => JSON.stringify({ uuid: 'u' + ++n, timestamp: ts, ...o });
const assistant = (content, extra = {}) => line({ type: 'assistant', message: { model: 'claude-opus-5-5', content, ...extra } });
const toolUse = (id, name, input = {}) => assistant([{ type: 'tool_use', id, name, input }]);
const toolResult = (id, content, isError) => line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: !!isError }] } });
const user = content => line({ type: 'user', message: { role: 'user', content } });
const feed = (norm, ...lines) => lines.flatMap(l => norm.line(l));

test('도구 이름에 맞는 방으로 보낸다', () => {
  assert.equal(roomOf('Read'), 'library');
  assert.equal(roomOf('Grep'), 'library');
  assert.equal(roomOf('Edit'), 'dev');
  assert.equal(roomOf('Bash'), 'server');
  assert.equal(roomOf('WebFetch'), 'search');
  assert.equal(roomOf('TodoWrite'), 'meeting');
  assert.equal(roomOf('Agent'), 'meeting');
  assert.equal(roomOf('AskUserQuestion'), 'desk');
  assert.equal(roomOf('mcp__github__create_pr'), 'search');
  assert.equal(roomOf('mcp__ccd_turn__update_plan'), 'meeting');
  assert.equal(roomOf('mcp__terminal__run'), 'server');
  assert.equal(roomOf('SomethingNew'), 'dev');
});

test('실제 기록에서 엉뚱한 방으로 가던 도구들을 바로잡는다', () => {
  assert.equal(roomOf('ListAgents'), 'meeting');
  assert.equal(roomOf('Artifact'), 'desk');
  assert.equal(roomOf('mcp__ccd_session_mgmt__list_sessions'), 'meeting');
  assert.equal(roomOf('mcp__ccd_view__show_pane'), 'desk');
  assert.equal(roomOf('mcp__ccd_pr__get_status'), 'server');
  assert.equal(roomOf('mcp__Claude_Code_iOS_Simulator__control'), 'server');
  assert.equal(roomOf('mcp__Claude_Browser__navigate'), 'search'); // 브라우저·바깥 서비스는 그대로
  assert.equal(roomOf('mcp__github__create_pull_request'), 'search');
});

test('처음 보는 도구는 이름을 보고 방을 고른다', () => {
  assert.equal(roomOf('RunTests'), 'server');
  assert.equal(roomOf('BrowserOpen'), 'search');
  assert.equal(roomOf('TeamCreate'), 'meeting');
  assert.equal(roomOf('NotifyUser'), 'desk');
  assert.equal(roomOf('ListFiles'), 'library');
  assert.equal(roomOf('DesignSync'), 'dev');
});

test('표지판에 쓸 짧은 이름을 만든다', () => {
  assert.equal(labelOf('Read', { file_path: '/a/b/server.js', offset: 120 }), 'server.js (120줄~)');
  assert.equal(labelOf('Bash', { command: 'npm test -- auth', description: '테스트 실행' }), '테스트 실행');
  assert.equal(labelOf('Bash', { command: 'git status\ngit diff' }), 'git status');
  assert.equal(labelOf('Grep', { pattern: 'Follower', path: '/x/public' }), '"Follower" · public');
  assert.equal(labelOf('WebFetch', { url: 'https://example.com/a/b' }), 'example.com');
  assert.equal(displayName('mcp__claude-in-chrome__navigate'), 'Chrome.navigate');
  assert.equal(displayName('mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__batch'), 'MCP.batch');
});

test('도구 사용과 결과, 실패 이유를 이벤트로 바꾼다', () => {
  const norm = new Normalizer();
  const evs = feed(norm,
    user('빌드 고쳐줘'),
    toolUse('t1', 'Bash', { command: 'npm test', description: '테스트' }),
    toolResult('t1', 'Exit code 1\nFAIL auth.spec.ts\nmore', true),
    toolUse('t2', 'Read', { file_path: '/p/a.js' }),
    toolResult('t2', 'ok'),
  );
  assert.deepEqual(evs.map(e => e.k), ['user', 'tool', 'result', 'tool', 'result']);
  assert.equal(evs[0].text, '빌드 고쳐줘');
  assert.equal(evs[1].room, 'server');
  assert.equal(evs[2].ok, false);
  assert.equal(evs[2].error, 'Exit code 1 · FAIL auth.spec.ts');
  assert.equal(evs[4].ok, true);
  assert.equal(norm.stats.tools, 2);
  assert.equal(norm.stats.errors, 1);
  assert.equal(norm.stats.server, 1);
  assert.equal(norm.stats.prompts, 1);
});

test('git 명령은 따로 표시한다', () => {
  const [ev] = feed(new Normalizer(), toolUse('g', 'Bash', { command: 'cd x && git commit -m "a"' }));
  assert.equal(ev.git, true);
  const [ev2] = feed(new Normalizer(), toolUse('g2', 'Bash', { command: 'echo digit' }));
  assert.equal(ev2.git, false);
});

test('거절·중단·턴 끝·압축·API 오류를 알아본다', () => {
  const norm = new Normalizer();
  const evs = feed(norm,
    toolUse('t1', 'Bash', { command: 'rm -rf /' }),
    toolResult('t1', "The user doesn't want to proceed with this tool use.", true),
    user('[Request interrupted by user]'),
    line({ type: 'system', subtype: 'turn_duration' }),
    line({ type: 'system', subtype: 'compact_boundary' }),
    line({ type: 'system', subtype: 'api_error', level: 'error', content: 'overloaded' }),
  );
  assert.equal(evs[1].error, '사용자가 실행을 거절했어요');
  assert.deepEqual(evs.slice(2).map(e => e.k), ['interrupt', 'turn_end', 'compact', 'apierr']);
});

test('생각과 말, 마지막 답을 구분한다', () => {
  const evs = feed(new Normalizer(),
    assistant([{ type: 'thinking', thinking: '**인증 흐름 살펴보기**\n자세한 내용' }]),
    assistant([{ type: 'text', text: '중간 보고예요.' }], { stop_reason: 'tool_use' }),
    assistant([{ type: 'text', text: '**다 고쳤어요.** `npm test` 통과' }], { stop_reason: 'end_turn' }),
  );
  assert.equal(evs[0].k, 'think');
  assert.equal(evs[0].text, '인증 흐름 살펴보기');
  assert.equal(evs[1].final, false);
  assert.equal(evs[2].final, true);
  assert.equal(evs[2].text, '다 고쳤어요. npm test 통과');
});

test('같은 줄을 두 번 읽어도 한 번만 센다', () => {
  const norm = new Normalizer();
  const l = toolUse('t1', 'Read', { file_path: 'a' });
  assert.equal(feed(norm, l, l).length, 1);
});

test('시스템이 붙인 내용은 사용자 메시지에서 뺀다', () => {
  const evs = feed(new Normalizer(),
    user([{ type: 'text', text: '<system-reminder>무시</system-reminder>' }, { type: 'text', text: '진짜 요청' }]),
    user('<command-name>/review</command-name><command-args>123</command-args>'),
    user('Caveat: 로컬 명령'),
  );
  assert.deepEqual(evs.map(e => e.text), ['진짜 요청', '/review 123']);
});

test('서브에이전트 줄은 기본으로 건너뛰고, sidechain으로 읽을 수 있다', () => {
  const l = JSON.stringify({ uuid: 'sc1', timestamp: ts, isSidechain: true, agentId: 'a1', type: 'assistant', message: { content: [{ type: 'tool_use', id: 's1', name: 'Grep', input: { pattern: 'x' } }] } });
  assert.equal(new Normalizer().line(l).length, 0);
  const [ev] = new Normalizer({ sidechain: true }).line(l);
  assert.equal(ev.room, 'library');
});

test('할 일 목록과 계획 갱신을 화이트보드로 옮긴다', () => {
  const norm = new Normalizer();
  feed(norm, toolUse('p1', 'TodoWrite', { todos: [
    { content: '조사', status: 'completed' },
    { content: '수정', activeForm: '수정하는 중', status: 'in_progress' },
    { content: '테스트', status: 'pending' },
  ] }));
  assert.deepEqual(norm.plan.items.map(i => [i.text, i.status]), [['조사', 'done'], ['수정하는 중', 'doing'], ['테스트', 'todo']]);

  const n2 = new Normalizer();
  feed(n2,
    toolUse('u1', 'mcp__ccd_turn__update_plan', { items: [{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }] }),
    toolUse('u2', 'mcp__ccd_turn__update_plan', { advance: true }),
  );
  assert.deepEqual(n2.plan.items.map(i => i.status), ['done', 'doing']);

  const n3 = new Normalizer();
  feed(n3,
    toolUse('c1', 'TaskCreate', { subject: '첫 일' }),
    toolUse('c2', 'TaskCreate', { subject: '둘째 일' }),
    toolUse('c3', 'TaskUpdate', { taskId: '1', status: 'completed' }),
    toolUse('c4', 'TaskUpdate', { taskId: '2', status: 'deleted' }),
  );
  assert.deepEqual(n3.plan.items.map(i => [i.text, i.status]), [['첫 일', 'done']]);
});

test('계획 승인 요청(ExitPlanMode)의 마크다운을 목록으로 바꾼다', () => {
  const p = planFromMarkdown('# 로그인 고치기\n\n1. 원인 찾기\n2. **테스트** 추가\n- [링크](http://x) 정리');
  assert.equal(p.title, '로그인 고치기');
  assert.deepEqual(p.items.map(i => i.text), ['원인 찾기', '테스트 추가', '링크 정리']);
});

test('질문과 답을 읽는다', () => {
  const norm = new Normalizer();
  const evs = feed(norm,
    toolUse('q1', 'AskUserQuestion', { questions: [{ question: '어떻게 할까요?', options: [{ label: '커밋' }, { label: 'PR' }] }] }),
    toolResult('q1', 'User has answered your questions: "어떻게 할까요?"="PR". You can now continue.'),
  );
  assert.equal(evs[0].ask, '어떻게 할까요?');
  assert.deepEqual(evs[0].options, ['커밋', 'PR']);
  assert.equal(evs[1].answer, 'PR');
});

test('아직 결과가 없는 도구를 찾는다 (권한 대기에 붙일 도구)', () => {
  const norm = new Normalizer();
  feed(norm,
    toolUse('a', 'Bash', { command: 'ls', description: '목록' }),
    toolUse('b', 'Bash', { command: 'npm test', description: '테스트' }),
    toolUse('c', 'Read', { file_path: 'x' }),
    toolResult('c', 'ok'),
    toolUse('d', 'AskUserQuestion', { questions: [] }),
  );
  assert.equal(norm.openTool(['Bash'], '목록'), 'a'); // 라벨이 같으면 그쪽
  assert.equal(norm.openTool(['Bash'], '없는 라벨'), 'b'); // 아니면 가장 최근
  assert.equal(norm.openTool(['Read'], ''), null); // 이미 끝난 도구
  assert.equal(norm.openTool([], ''), 'b'); // 이름 없이 찾으면 질문 도구는 빼고 가장 최근
});
