---
name: journal
description: 오늘 Claude Code로 한 일(프로젝트별 일한 시간·도구·인턴)을 Claude 사무실 업무 일지로 보여 줘요.
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Bash로 아래 명령을 한 번만 실행하고, 출력된 업무 일지를 그대로 사용자에게 보여 주세요. 다른 작업은 하지 마세요.

```bash
node "${CLAUDE_PLUGIN_ROOT}/server.js" --journal
```
