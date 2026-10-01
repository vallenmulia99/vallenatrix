# vallenagent - Architecture & Agent Guide

Autonomous AI Agent runtime implemented in TypeScript, following Hermes Agent architectural patterns. Embedded directly into Vallenatrix Terminal via IPC.

## Overview & Core Principles

- **Waist-at-the-core:** The core agent loop (`AIAgent`) is lean and handles turn progression, message alternation, and tool schema dispatch.
- **Strict Alternation:** Assistant messages are sanitized (`content` + `tool_calls`). Tool results are fed back with matching `tool_call_id`.
- **Indonesian Slang Context:** Prompts recognize Indonesian affirmative commands ("gas", "gasin", "lanjut", "terapkan") as immediate execution signals without confirmation prompts.
- **Zero Fabrication:** Agent must execute real tools and never fabricate output data.

## Project Structure (`vallenagent/src`)

- `agent.ts`: `AIAgent` turn loop. Handles context assembly, tool calls, 9router streaming callbacks, telemetry, and response packaging.
- `builtin_tools.ts`: 12 full Hermes toolsets:
  - `file`: `read_file`, `write_file`, `patch`, `search_files`.
  - `terminal`: `terminal` command execution with stdout/stderr capture and 50KB head/tail cap.
  - `code_execution`: `execute_code` (isolated python3 subprocess runner).
  - `web`: `web_search` (DuckDuckGo search) & `web_extract` (clean HTML-to-markdown extraction).
  - `clarify`: `clarify` structured user feedback tool.
  - `memory`: `memory` persistent notes store (`MEMORY.md` & `USER.md`).
  - `todo`: `todo_list` revisioned task tracker.
  - `image_gen`: `image_generate` (local visual asset generation).
  - `browser-use`: `browser_exec` (Playwright/Browser Use script execution).
  - `connections`: `manage_connections` (workspace & API health status).
  - `delegation`: `delegate_task` (isolated child subagent runner).
  - `skills`: `skill_view`, `skills_list`, `skill_manage` (SKILL.md authoring & retrieval).
  - *Patch Engine*: 9-tier fuzzy replacement (`exact`, `line_trimmed`, `whitespace_normalized`, `indentation_flexible`, `escape_normalized`, `trimmed_boundary`, `unicode_normalized`, `block_anchor`, `similarity_match`).
- `display.ts`: Hermes-style TUI formatting:
  - Tree-style tool calls: `  ┊ <emoji> preparing <name>…` and `  ┊ <emoji> <verb:9> <detail>  <duration>s`.
  - Inline diff preview: `  ┊ review diff` with syntax-colored lines.
  - Smart path shortening via `cutePath()`.
  - Symmetrical response container via `formatResponseBox()` with ` ☤ Vallenatrix ` header.
- `memory.ts`: `MemoryStore` disk manager (`~/.vallenatrix/memories/`). Auto-injected into the system prompt.
- `todo.ts`: `TodoStore` memory task queue. Auto-injected into the system prompt.
- `skills.ts`: `SkillLoader` scanning SKILL.md documents and parsing frontmatter.
- `tools.ts`: `ToolRegistry` managing schemas and executing handlers.
- `providers.ts`: `OpenAICompatibleProvider` for 9router (`http://127.0.0.1:20128/v1`).
- `config.ts`: Loads and persists settings to `.vallenatrix/config.json`.

## Common Commands

```bash
# Build TypeScript
npm run build

# Run Unit Tests (6 suites, zero mocks needed)
npm test
```

## Critical Pitfalls & Invariants

1. **Local Model Provider (9router):** Default endpoint is `http://127.0.0.1:20128/v1`. Default model is `ag/gemini-3.8-flash-medium`. Tool calling format is standard OpenAI function calling.
2. **Context Contamination in Tests:** Dynamic strings must be used for sensitive/secret tokens during multi-turn testing so `search_files` tool calls don't accidentally match static strings in the test file itself.
3. **No Unrequested Scaffolding:** Keep edits minimal. Follow YAGNI strictly.
