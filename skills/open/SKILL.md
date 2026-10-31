---
name: open
description: Claude 사무실(Claude Code 활동을 캐릭터로 보여 주는 화면)을 뒤에서 켜고 브라우저로 열어요. 이미 켜져 있으면 화면만 열어요.
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Bash로 아래 명령을 한 번만 실행하세요. 명령은 바로 끝나고, 사무실 서버는 뒤에서 계속 돌아요.

```bash
node "${CLAUDE_PLUGIN_ROOT}/server.js" --background
```

실행 결과에 나온 주소를 사용자에게 한 줄로 알려 주세요. 끄는 방법은 `/office:stop`이라고 덧붙이세요. 다른 작업은 하지 마세요.
