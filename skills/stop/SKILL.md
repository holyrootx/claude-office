---
name: stop
description: 뒤에서 켜 둔 Claude 사무실 서버를 꺼요.
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Bash로 아래 명령을 한 번만 실행하고, 결과를 사용자에게 한 줄로 알려 주세요. 다른 작업은 하지 마세요.

```bash
node "${CLAUDE_PLUGIN_ROOT}/server.js" --stop
```
