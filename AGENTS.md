# Vallenatrix - AI Agent & Developer Guide

Monorepo workspace consisting of two primary packages:
1. `vallenagent/`: Autonomous AI agent core runtime (TypeScript, Hermes-inspired).
2. `vallenterminal/`: Transparent Linux Electron terminal emulator with bottom AI chat bar.

## Project Structure

```text
vallenatrix/
├── package.json               # Root workspaces config ("vallenterminal", "vallenagent")
├── AGENTS.md                  # This file: root workspace index and guidelines
├── .vallenatrix/              # Bundled runtime dir (skills seeded into ~/.vallenatrix on first run)
│   ├── config.json            # Active provider, token, model, and skill paths (gitignored)
│   ├── skills/                # Bundled skills source of truth (91 skills, 22 categories)
│   └── memories/              # MEMORY.md and USER.md persistent store (gitignored)
├── vallenagent/               # Agent Core Runtime
│   ├── AGENTS.md              # Detailed agent architecture & toolsets guide
│   ├── src/                   # Agent source code (agent, tools, approval, display, memory, todo)
│   └── tests/                 # Unit test suite (node --test, 63 suites)
└── vallenterminal/            # Electron Frontend & Terminal
    ├── AGENTS.md              # Detailed UI layout, IPC, and electron-vite guide
    ├── electron-vite.config.ts# Build configuration
    └── src/                   # Main, preload, renderer, shared
```

`vallenprd/` is a separate local app with its own toolchain (Node 22+) and is **not** part of
this repo's workspaces; it stays untracked here and ships from its own repository.

## Quick Verification & Builds

```bash
# Build both packages
npm -w vallenagent run build && npm -w vallenterminal run build

# Run agent unit tests (6 test suites)
npm -w vallenagent test

# Start the application
npm start
```

## Cross-Package Integration

- `vallenterminal/src/main/index.ts` loads `vallenagent/dist/index.js` dynamically via `require()`.
- Two-way IPC communication:
  - Renderer sends user message via `window.api.chatAgent(message, model)` -> IPC `agent:chat`.
  - Main process invokes `AIAgent.chat(message, callbacks)`.
  - As tools execute, main broadcasts events via IPC `agent:status` -> Renderer prints `  ┊` tool traces in real time into the terminal view.
  - Final response returns to renderer and is printed inside `╭─ ☤ Vallenatrix ───╮`.

Read `vallenagent/AGENTS.md` and `vallenterminal/AGENTS.md` before making edits to individual workspaces.
