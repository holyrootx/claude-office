// 화면을 그리기 전에 먼저 도는 작은 준비 (CSP 때문에 index.html 안에 쓰지 않고 파일로 둔다)
// 밝은/어두운 화면은 컴퓨터 설정을 따라간다. 위쪽 🌓 버튼으로 고른 것(기억해 둔다)이나 ?theme=light|dark가 있으면 그걸로.
// 그리기 전에 정해야 화면이 한 번 번쩍이지 않는다.
(function () {
  var m = /[?&]theme=(light|dark)\b/.exec(location.search);
  var t = m ? m[1] : null;
  if (!t) try { t = localStorage.getItem('claude-office-theme'); } catch (e) { /* 저장소 없음 */ }
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
})();
// 웹 글꼴은 화면을 막지 않게 따로 불러온다: 못 받아도 기본 글꼴로 바로 뜨고, 받으면 바꿔 끼운다.
// 주소에 ?nofonts를 붙이면 바깥(Google Fonts)에 아예 연결하지 않는다.
(function () {
  if (/[?&]nofonts\b/.test(location.search)) return;
  var add = function (attrs) { var l = document.createElement('link'); for (var k in attrs) l.setAttribute(k, attrs[k]); document.head.appendChild(l); };
  add({ rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' });
  add({ rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Gaegu:wght@400;700&family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&family=Nanum+Pen+Script&display=swap' });
})();
