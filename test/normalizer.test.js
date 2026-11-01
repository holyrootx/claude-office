// 세션 기록(jsonl) 한 줄 한 줄을 화면용 이벤트로 바꾸는 부분을 실제 기록 모양으로 확인한다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
// 내 진짜 ~/.claude/claude-office.json 설정이 결과를 바꾸지 않게 빈 임시 폴더를 쓴다
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-norm-'));
const { Normalizer, roomOf, labelOf, displayName, planFromMarkdown, contextWindow, roomRules, ROOM_CONFIG, rootCwd } = require('../server.js');

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

test('내 방 설정 파일이 있으면 그 규칙을 먼저 쓴다', () => {
  assert.equal(roomOf('mcp__github__create_pull_request'), 'search');
  fs.writeFileSync(ROOM_CONFIG, JSON.stringify({ rooms: {
    'mcp__github__*': 'server',
    'mcp__linear__*': '회의실', // 한국어 방 이름도 된다
    'Bash': 'library', // 기본 규칙보다 먼저
    'mcp__x__*': '없는 방', // 모르는 방은 건너뛴다
  } }));
  roomRules.get(true);
  assert.equal(roomOf('mcp__github__create_pull_request'), 'server');
  assert.equal(roomOf('mcp__linear__list_issues'), 'meeting');
  assert.equal(roomOf('Bash'), 'library');
  assert.equal(roomOf('mcp__x__y'), 'search');
  assert.equal(roomOf('mcp__githubx__a'), 'search'); // 패턴은 이름 전체가 맞아야 한다
  fs.writeFileSync(ROOM_CONFIG, '{ 망가진 json');
  roomRules.mtime = -2;
  roomRules.get(true);
  assert.equal(roomOf('mcp__github__create_pull_request'), 'search'); // 읽지 못하면 기본 규칙
  fs.unlinkSync(ROOM_CONFIG);
  roomRules.get(true);
  assert.equal(roomOf('Bash'), 'server');
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

test('마지막 답의 usage로 컨텍스트 크기를 잰다', () => {
  const norm = new Normalizer();
  feed(norm,
    assistant([{ type: 'text', text: 'a' }], { usage: { input_tokens: 5, cache_creation_input_tokens: 1000, cache_read_input_tokens: 50000, output_tokens: 99 } }),
    assistant([{ type: 'text', text: 'b' }], { usage: { input_tokens: 2, cache_creation_input_tokens: 300, cache_read_input_tokens: 52000, output_tokens: 10 } }),
  );
  assert.equal(norm.ctx, 52302); // 가장 최근 값, 출력 토큰은 빼고
  assert.equal(contextWindow('claude-opus-5-5', 1000), 1000000);
  assert.equal(contextWindow('claude-sonnet-4-5', 1000), 200000);
  assert.equal(contextWindow('claude-sonnet-4-5[1m]', 1000), 1000000);
  assert.equal(contextWindow('claude-sonnet-4-5', 250000), 1000000); // 이미 20만을 넘었다면 큰 창
});

test('API 오류를 알아듣기 쉽게 바꾼다', () => {
  const sys = o => JSON.stringify({ uuid: 'e' + ++n, timestamp: ts, type: 'system', subtype: 'api_error', level: 'error', ...o });
  const [a, b, c] = feed(new Normalizer(),
    sys({ error: { message: '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' }, retryAttempt: 1, maxRetries: 7 }),
    sys({ error: { message: '429 {"type":"error","error":{"type":"rate_limit_error","message":"x"}}' } }),
    sys({ content: 'fetch failed: ECONNRESET' }),
  );
  assert.equal(a.text, 'Anthropic 서버가 붐벼요 (529) · 다시 시도 1/7');
  assert.equal(b.text, '요청 한도에 걸렸어요 (429)');
  assert.equal(c.text, '인터넷 연결이 끊겼어요');
});

test('세션 정보: 자동 제목, PR, 비용, 권한 모드를 읽는다', () => {
  const norm = new Normalizer();
  feed(norm,
    line({ type: 'ai-title', aiTitle: '로그인 버그 고치기' }),
    line({ type: 'pr-link', prNumber: 17, prUrl: 'https://github.com/a/b/pull/17', prRepository: 'a/b' }),
    line({ type: 'cost-state', totalCostUSD: 12.5, totalLinesAdded: 300, totalLinesRemoved: 20 }),
    line({ type: 'mode', mode: 'plan' }),
  );
  assert.equal(norm.meta.aiTitle, '로그인 버그 고치기');
  assert.deepEqual(norm.meta.pr, { number: 17, url: 'https://github.com/a/b/pull/17', repo: 'a/b' });
  assert.deepEqual(norm.meta.cost, { usd: 12.5, added: 300, removed: 20 });
  assert.equal(norm.meta.mode, 'plan');
});

test('압축 전후 토큰을 읽고, 같은 압축은 한 번만 알린다', () => {
  const norm = new Normalizer();
  norm.ctx = 960000;
  const evs = feed(norm,
    line({ type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 968026, postTokens: 19254 } }),
    line({ type: 'user', isCompactSummary: true, message: { role: 'user', content: '요약' } }),
  );
  assert.equal(evs.length, 1);
  assert.deepEqual([evs[0].k, evs[0].trigger, evs[0].pre, evs[0].post], ['compact', 'auto', 968026, 19254]);
  assert.equal(norm.ctx, 19254); // 다음 답을 기다리지 않고 바로 줄어든다
});

test('바쁠 때 보낸 내 메시지 대기열을 따라간다', () => {
  const norm = new Normalizer();
  const q = o => JSON.stringify({ type: 'queue-operation', timestamp: ts, ...o });
  feed(norm, q({ operation: 'enqueue', content: '바로 처리' }), q({ operation: 'dequeue' })); // 평소 메시지: 넣자마자 받아 감
  assert.deepEqual(norm.queue, []);
  feed(norm, q({ operation: 'enqueue', content: '이것도 해 줘' }), q({ operation: 'enqueue', content: '그리고 저것도' }));
  assert.deepEqual(norm.queue, ['이것도 해 줘', '그리고 저것도']);
  feed(norm, q({ operation: 'remove', content: '그리고 저것도' }));
  assert.deepEqual(norm.queue, ['이것도 해 줘']);
  feed(norm, q({ operation: 'dequeue' }));
  assert.deepEqual(norm.queue, []);
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

test('출력 토큰은 답(message.id)마다 한 번만 센다', () => {
  const norm = new Normalizer();
  const usage = { input_tokens: 3, cache_read_input_tokens: 90000, output_tokens: 1200 };
  // 답 하나가 생각·도구 두 줄로 나뉘어 기록되고, usage는 두 줄에 똑같이 붙는다
  const evs = feed(norm,
    assistant([{ type: 'thinking', thinking: '살펴보자' }], { id: 'msg_1', usage }),
    assistant([{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a' } }], { id: 'msg_1', usage }),
    assistant([{ type: 'text', text: '다 봤어요' }], { id: 'msg_2', usage: { ...usage, output_tokens: 80 }, stop_reason: 'end_turn' }),
  );
  assert.equal(evs.reduce((n, e) => n + (e.tok || 0), 0), 1280);
  assert.equal(evs[0].tok, 1200);
  // 오류 안내처럼 진짜 답이 아닌 것은 세지 않는다
  const syn = feed(new Normalizer(), line({ type: 'assistant', message: { model: '<synthetic>', id: 'x', usage, content: [{ type: 'text', text: 'API Error' }] } }));
  assert.equal(syn[0].tok, undefined);
});

test('망가진 JSON으로 남은 도구 입력도 질문·파일 이름은 건진다 (__unparsedToolInput)', () => {
  const norm = new Normalizer();
  const raw = '{"questions": [{"question": "application.yaml\\uc758 \\ubcc0\\uacbd, \\ub9de\\ub098\\uc694?", "header": "확인"';
  const [ask] = feed(norm, assistant([{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { __unparsedToolInput: { raw, len: raw.length } } }]));
  assert.equal(ask.ask, 'application.yaml의 변경, 맞나요?');
  const [read] = feed(norm, assistant([{ type: 'tool_use', id: 'r1', name: 'Read', input: { __unparsedToolInput: { raw: '{"file_path": "/a/b/PostBody.vue", "offset": 70">\n, "limit": 20}' } } }]));
  assert.equal(read.label, 'PostBody.vue');
  assert.equal(read.detail, '/a/b/PostBody.vue');
});

test('표지판 글자가 비던 도구들: 브라우저 묶음, 창 크기, Jira, 크론, 메시지', () => {
  const batch = { actions: [{ name: 'navigate', input: { url: 'http://x' } }, { name: 'computer', input: { action: 'wait' } }, { name: 'computer', input: { action: 'wait' } }, { name: 'computer', input: { action: 'screenshot' } }] };
  assert.equal(labelOf('mcp__Claude_Browser__browser_batch', batch), '4단계 · navigate → wait ×2 → screenshot');
  assert.equal(labelOf('mcp__Claude_Browser__resize_window', { width: 1280, height: 850 }), '1280×850');
  assert.equal(labelOf('mcp__Claude_Browser__resize_window', { preset: 'mobile' }), 'mobile');
  const jira = 'mcp__9be74c07-6424-43bb-ba00-725d536ca1b7__';
  assert.equal(labelOf(jira + 'addCommentToJiraIssue', { cloudId: 'c', issueIdOrKey: 'QA-1', commentBody: '긴 글' }), 'QA-1');
  assert.equal(labelOf(jira + 'searchJiraIssuesUsingJql', { cloudId: 'c', jql: 'project = KAN' }), 'project = KAN');
  assert.equal(labelOf('mcp__mcp-registry__search_mcp_registry', { keywords: ['jira', 'confluence'] }), 'jira, confluence');
  assert.equal(labelOf('mcp__ccd_session_mgmt__send_message', { message: '**버그 두 개**가 있어요\n자세히는…' }), '버그 두 개가 있어요');
  assert.equal(labelOf('SendMessage', { to: 'a8fe', summary: '전제가 바뀌었어요', message: '긴 글' }), '전제가 바뀌었어요');
  assert.equal(labelOf('CronCreate', { cron: '17 * * * *', prompt: '자동 개선 1회' }), '17 * * * * · 자동 개선 1회');
  assert.equal(labelOf('Monitor', { description: '테스트 끝날 때까지', command: 'until …' }), '테스트 끝날 때까지');
  assert.equal(labelOf('Artifact', { action: 'publish', file_path: '/tmp/x/report.html' }), 'publish · report.html');
});

test('Claude Code가 써 넣은 안내: 사용 한도는 쉬는 중, 나머지는 쉬운 말로, 필요 없는 건 뺀다', () => {
  const note = t => feed(new Normalizer(), assistant([{ type: 'text', text: t }], { model: '<synthetic>' }))[0];
  assert.deepEqual(
    (({ kind, resets }) => ({ kind, resets }))(note("You've hit your session limit · resets 12:40am (Asia/Seoul)")),
    { kind: 'limit', resets: '오전 12:40' },
  );
  assert.equal(note("You've hit your session limit · resets 6pm (Asia/Seoul)").resets, '오후 6:00');
  assert.equal(note('No response requested.'), undefined);
  assert.equal(note('API Error: Your computer went to sleep mid-response.').stop, true); // 이번 차례는 여기서 끝
  // 다시 시도 중인 system api_error 줄은 stop이 없다
  assert.equal(feed(new Normalizer(), line({ type: 'system', subtype: 'api_error', level: 'error', content: '529 overloaded', retryAttempt: 1, maxRetries: 7 }))[0].stop, undefined);
  assert.equal(note('API Error: Your computer went to sleep mid-response. The response above may be incomplete.').text, '컴퓨터가 잠들어서 답이 중간에 끊겼어요');
  assert.equal(note("API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)").text, '인터넷 연결이 끊겼어요');
  assert.equal(note('API Error: 529 Overloaded. This is a server-side issue, usually temporary.').text, 'Anthropic 서버가 붐벼요 (529)');
  assert.equal(note('Failed to authenticate. API Error: 401 OAuth access token has expired.').text, '로그인이 풀렸어요 (401)');
});

test('사용 한도가 풀리는 때(resetAt)를 기록 시각 뒤로 처음 돌아오는 그 시각으로 잡는다', () => {
  const at = (when, text) => {
    const l = JSON.stringify({ type: 'assistant', timestamp: new Date(when).toISOString(), message: { model: '<synthetic>', content: [{ type: 'text', text }] } });
    return new Normalizer().line(l)[0].resetAt;
  };
  const night = new Date(2026, 10, 2, 23, 10).getTime();
  assert.equal(at(night, "You've hit your session limit · resets 12:40am (Asia/Seoul)"), new Date(2026, 10, 3, 0, 40).getTime()); // 다음 날
  const morning = new Date(2026, 10, 2, 10, 0).getTime();
  assert.equal(at(morning, "You've hit your session limit · resets 1:40pm (Asia/Seoul)"), new Date(2026, 10, 2, 13, 40).getTime()); // 같은 날
  assert.equal(at(morning, 'Claude AI usage limit reached|1793563200'), 1793563200 * 1000);
  assert.equal(at(morning, "You've hit your weekly limit"), 0); // 언제 풀리는지 모르면 0
});

test('세션 중에 하위 폴더로 옮겨 다녀도 시작한 폴더를 찾는다 (기록 폴더 이름과 맞는 위 폴더)', () => {
  const dir = '-Users-me-work-blog';
  assert.equal(rootCwd(['/Users/me/work/blog/frontend'], dir), '/Users/me/work/blog');
  assert.equal(rootCwd(['/Users/me/work/blog/.claude/worktrees/x/backend'], dir), '/Users/me/work/blog');
  assert.equal(rootCwd(['/tmp/else', '/Users/me/work/blog/backend'], dir), '/Users/me/work/blog');
  assert.equal(rootCwd(['C:\\code\\shop\\web'], 'C--code-shop'), 'C:\\code\\shop');
  assert.equal(rootCwd(['/Users/me/돈/src'], '-Users-me--'), '/Users/me/돈');
  assert.equal(rootCwd(['/tmp/else'], dir), '/tmp/else'); // 맞는 게 없으면 처음 본 폴더
});

