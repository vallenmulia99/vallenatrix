# Vallenatrix - AI Agent & Developer Guide

Monorepo workspace consisting of two primary packages:
1. `vallenagent/`: Autonomous AI agent core runtime (TypeScript, Hermes-inspired).
2. `vallenterminal/`: Transparent Linux Electron terminal emulator with bottom AI chat bar.

## Project Structure

```text
/home/vallenganteng/Destop/vallenatrix/
├── package.json               # Root workspaces config ("vallenterminal", "vallenagent")
├── AGENTS.md                  # This file: root workspace index and guidelines
├── .vallenatrix/              # Local runtime directory (skills, config, memories)
│   ├── config.json            # Active provider, token, model, and skill paths
│   ├── skills/                # Local skills directory
│   └── memories/              # MEMORY.md and USER.md persistent store
├── vallenagent/               # Agent Core Runtime
│   ├── AGENTS.md              # Detailed agent architecture & toolsets guide
│   ├── src/                   # Agent source code (agent, tools, display, memory, todo)
│   └── tests/                 # Unit test suite (node --test)
└── vallenterminal/            # Electron Frontend & Terminal
    ├── AGENTS.md              # Detailed UI layout, IPC, and electron-vite guide
    ├── electron-vite.config.ts# Build configuration
    └── src/                   # Main, preload, renderer, shared
```

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
