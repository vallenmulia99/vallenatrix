---
name: vallenatrix
description: "Use, configure, debug, and extend Vallenatrix."
version: 1.1.0
author: Vallen + Vallenatrix Team
license: MIT
platforms: [linux]
category: autonomous-ai-agents
triggers: [Vallenatrix, Vallenatrix terminal, vallenagent, vallenterminal, Electron terminal]
metadata:
  vallenatrix:
    related_skills: [hermes-agent, claude-code]
---

# Vallenatrix Skill

Use this guide for Vallenatrix's Electron terminal and embedded TypeScript agent. Hermes Agent is a design reference, not proof that Vallenatrix has the same commands or integrations. Treat this repository's source, tests, and `AGENTS.md` files as authoritative.

## When to Use

- Run, configure, troubleshoot, or extend Vallenatrix.
- Change `vallenagent/`, `vallenterminal/`, IPC, agent tools, or Vallenatrix skills.
- Check whether a Vallenatrix feature exists or works.

Don't use for unrelated Hermes Agent setup; load `hermes-agent` instead.

## Prerequisites

- Linux, Node.js, npm, and project dependencies.
- Default model route uses 9router at `http://127.0.0.1:20128/v1`; default model is `ag/gemini-3.8-flash-medium`.
- Runtime data defaults to `~/.vallenatrix/`. `VALLENATRIX_HOME` overrides this root. Provider credentials live in `config.json`; do not print, paste into shell commands, or commit them.
- Project guides: `AGENTS.md`, `vallenagent/AGENTS.md`, and `vallenterminal/AGENTS.md`. Read relevant files before editing.

## How to Run

From repository root:

```bash
npm run dev       # Build agent and start Electron development mode
npm start         # Build agent and launch Electron
npm run typecheck # Typecheck both workspaces
npm run build     # Build both workspaces
npm test          # Run agent and terminal test suites
```

For installation, inspect `install.sh` first. `--purge` deletes config, API keys, sessions, memories, and themes; never run it without explicit user approval.

## Quick Reference

- Agent core: `vallenagent/src/agent.ts`; provider: `providers.ts`; tool schemas/handlers: `builtin_tools.ts`; registry: `tools.ts`.
- Skill loading/sync: `skills.ts`, `skills_sync.ts`; display and diff formatting: `display.ts`.
- Persistence: `memory.ts`, `todo.ts`, `session.ts`; gateway: `gateway/`.
- Electron IPC and slash commands: `vallenterminal/src/main/index.ts`; bridge: `preload/index.ts`; UI: `renderer/main.ts`; IPC names/types: `shared/`.
- Runtime config: `$VALLENATRIX_HOME/config.json` or `~/.vallenatrix/config.json`; skills: `$VALLENATRIX_HOME/skills/`; memories and sessions: corresponding `memories/` and `sessions/` directories.
- Common slash commands: `/help`, `/model`, `/token`, `/tools`, `/skills`, `/themes`, `/theme`, `/stats`, `/memory`, `/todos`, `/sessions`, `/resume`, `/stop`, `/pty` or `/sh`, `/new` or `/reset`, `/clear`.

## Procedure

1. Confirm repository root and inspect `git status --short`. Preserve unrelated changes and user data.
2. Read root `AGENTS.md` plus relevant workspace guide. For feature claims, inspect source and tests; don't rely on stale docs alone.
3. Trace the complete path before editing: renderer/input → IPC/preload → `AIAgent` or tool handler → status/output renderer. For agent work, inspect `builtin_tools.ts` and registry behavior; for UI work, read `vallenterminal/AGENTS.md` and renderer code.
4. Make the smallest change that meets request. Reuse installed dependencies and existing patterns. Do not copy Hermes commands, APIs, or guarantees unless Vallenatrix source implements them.
5. Add or update a behavior test. Run the narrow test first, then `npm run typecheck`, `npm run build`, and `npm test` for cross-package changes.
6. If change affects Electron rendering or hardware behavior, launch app and verify visible behavior when possible; passing unit tests alone does not prove UI behavior.
7. Report changed files, exact verification results, and remaining limitations. Never claim an integration is live based only on a tool name or mock response.

## Agent Output and Coding Workflow

- For repository work, use `search_files`/`read_file` to inspect and `patch`/`write_file` to edit. Use `terminal` for commands that must execute: tests, builds, git, and runtime checks. Do not browse or edit files with shell when a dedicated tool is available.
- `preparing <tool>` means an operation is starting; its following completion line should report result, duration, or error. Preparing lines include a safe, short path, command, pattern, or skill name when available.
- A `write_file` completion may show `review diff` for a changed existing text file. New, unchanged, binary, oversized, or >20 KB diff cases report why the preview was omitted. A diff is evidence of the proposed change, not proof tests pass.
- Skill preload progress is reported before model work. The loaded-skill completion appears only after selected skill content has been included in the outgoing model request. `skill_view` remains available for additional linked skill content.
- For substantial coding work: inspect instructions and worktree; find the relevant implementation and tests; make a focused change; run focused tests, then workspace tests/builds; report exact verification and remaining limits. Do not claim a GUI/IPC path is verified from unit tests alone.
- Background self-review is asynchronous. Its brief notice reports only confirmed durable skill or memory updates; no-op review stays silent. Review errors must not fail the foreground task.

## Capabilities and Limits

- Agent tools include file operations, shell execution, Python `execute_code`, web search/extraction, memory/todo/session, skills, delegation, image tools, and browser automation. Confirm each tool's current handler and configuration before promising behavior.
- `browser_exec` rejects named `session` values; don't promise persistent or isolated browser sessions.
- `clarify` cannot collect structured answers from UI in this runtime. Ask user directly and wait before making a decision that depends on their answer.
- `manage_connections` does not connect hosted accounts; it reports that hosted connectors are not integrated. Never claim account status or authorization.
- Background self-review may run after a successful parent-agent turn. A completion notification is not evidence that a proposed memory change was staged for approval; inspect review and memory implementation before promising approval workflow.
- `/token` writes provider credentials to local config. Keep tokens out of output, tests, screenshots, commits, and reports.

## Pitfalls

- Electron renderer, agent runtime, and ordinary shell are separate surfaces. A tool trace in terminal output does not prove renderer UI works.
- `npm run dev` rebuilds the agent before starting Electron; restart a running app to load changed code.
- Protect user-owned data. Do not overwrite `.vallenatrix/skills/custom/`, unrelated skill files, `BUGS.md`, or `update.sh` unless explicitly requested.
- Intel GMA 4500MHD on Debian can hang with default iHD VA-API driver. Use `LIBVA_DRIVER_NAME=i965` or disable `VaapiVideoDecoder` and `VaapiVideoEncoder` when this specific issue occurs.
- Treat `install.sh --purge` as destructive; it removes secrets and user state, not just the application.

## Verification

- `git diff --check` exits 0.
- `npm run typecheck`, `npm run build`, and `npm test` exit 0 for project-wide changes.
- Regression tests assert user-visible behavior or tool contracts, not merely source text.
- For visual/IPC work, confirm actual Electron behavior separately; state when GUI verification was not performed.
