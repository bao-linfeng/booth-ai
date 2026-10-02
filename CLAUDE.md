# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

---

各子项目目录下的 `CLAUDE.md` 只导入同目录的 `AGENTS.md`，在该目录读写文件时由 Claude Code 自动加载。规则一律写进对应的 `AGENTS.md`，不要写在 `CLAUDE.md` 里，以便其他 Agent 共用。

仅针对 Claude Code 的补充：

- `.claude/settings.local.json` 配置了 `server-deploy-guard` Hook：`apps/server` 或 `infra/compose.dev.yaml` 有改动但未重新部署 dev 栈时，会阻止结束回合。部署规则见 `apps/server/AGENTS.md`。
