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
- `verification.ts`: Records real verification evidence (test/build/lint with exit code and result summary) per session, injects a compact evidence block into the request, and nudges once when files changed without any verification run.
- `turn_recovery.ts`: Writes a turn checkpoint when a long turn dies mid-way and builds the resume prompt; `AIAgent.resumePrompt()` exposes it. Checkpoints live next to the session files, mode 0600.
- `compaction.ts` + `summarizer.ts`: Model-backed history compaction (temperature 0, factual handover prompt) with automatic fallback to the rule-based `compactHistory`. Disable with `gateway.llm_compaction: false`.
- `prompt_cache.ts`: Marks the stable prompt prefix with `cache_control` for cache-capable providers; on a 400/invalid-field rejection it retries without markers and switches itself off. Kill switch `VALLENATRIX_PROMPT_CACHE=off`.
- `session_search.ts`: Keyword search over saved sessions, exposed as the `session_search` tool (toolset `memory`).
- `approval.ts`: Single approval policy shared by every surface. `requiresApproval(info, mode)` returns whether a tool call must be confirmed; `approvalMode()` resolves `VALLENATRIX_APPROVAL` env override, then the surface config, then defaults to `dangerous`. Destructive shell (`rm -rf`, `dd`, `mkfs`, force-push, remote uploads), `execute_code`, `browser_exec`, mutating `skill_manage`, and any path inside `.ssh`/`.aws`/`.gnupg`/`.config`/`.kube`/`.docker`/`.vallenatrix`/`/etc`/`/usr`/`/boot`/`/root` are gated; ordinary project commands are not. `dangerous` gates risky ops, `all` gates every call, `off` disables.

## Interactive approval flow

The Electron chat and the Telegram gateway both answer through `callbacks.onBeforeTool`. Both wait for a human: the renderer shows `Balas y untuk izinkan atau n untuk tolak.` and resolves via IPC `agent:approval`; Telegram sends inline approve/deny buttons. Both fail closed after a timeout (5 min in the terminal, `gateway.telegram.turn_timeout_ms` remotely). Telegram pairing codes are stored only as a SHA-256 hash in `~/.vallenatrix/gateway/telegram.json` (0600) and compared with `timingSafeEqual`.

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


## Context & Budget Tuning (config.json)

| Key | Default | Arti |
|---|---|---|
| `max_tokens_per_turn` | 400000 | Budget **output** (completion) token per turn. Prompt token TIDAK dihitung (konteks dikirim ulang tiap iterasi). |
| `max_output_tokens` | 16384 | Batas `max_tokens` per satu request. Turunkan kalau model punya limit output kecil. |
| `context_windows` | `{}` | Map `model -> ukuran window`. Isi sesuai model yang dipakai supaya kompaksi tepat waktu. |
| `default_context_window` | 128000 | Dipakai untuk model yang tidak ada di `context_windows`. Set 32000/64000 kalau model/router kecil. |
| `temperature` | (kosong) | Diteruskan ke provider kalau diisi. 0 - 0.3 disarankan untuk coding. |

Perilaku konteks:
- Kompaksi history lama: saat konteks > 70% window, atau history > 80 pesan.
- Kalau satu turn sangat panjang, langkah lama di dalam turn itu juga diringkas (blok `[Progress so far in this task]` di pesan user aktif).
- Ringkasan menyimpan task asli, langkah TERBARU, daftar tool call, dan `Files touched`. Ukurannya dibatasi relatif ke window.
- Output tool lama baru di-prune kalau konteks > 50% window (sisakan 24 pesan terakhir; > 85% sisakan 6) dan tetap menyimpan cuplikan awal.
- Skill yang di-preload dibatasi ~15% window.
