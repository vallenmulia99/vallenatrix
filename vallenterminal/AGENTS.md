# vallenterminal - Architecture & Agent Guide

Transparent Linux Electron Terminal Emulator with custom UI, anime/media background support, interactive pet, and integrated AI assistant chat interface.

## UI Layout & Composition

- **Titlebar (34px):** Window drag area, window action buttons (minimize, maximize, close), font size adjustments, theme and background toggles.
- **Terminal Area (flex 1):** Full xterm.js instance with WebGL/Canvas renderer. Displays user shell output or AI assistant responses in read-only terminal mode.
- **Status Bar (26px):**
  - Left: Active AI model selector dropdown, current working directory, and live agent status indicator (`Agent thinking...`, `Agent running tool...`, `Ready`).
  - Right: Context window usage meter (`[██░░░░░░░░] ~15%`), visual token telemetry (`◷ 1.2s │ ↑ 45 t/s`), and interactive pet canvas.
- **Bottom Chat Input (48px):** Primary input bar for chatting with Vallen AI Agent. Terminal keyboard input is blocked outside this chat bar and modal settings dialogs.

## Directory Structure (`vallenterminal/src`)

- `main/index.ts`:
  - Electron app lifecycle and window creation (`BrowserWindow` with transparent background, frameless frame).
  - PTY process manager (`node-pty`) with clean spawn and resize handlers.
  - IPC handler for `agent:chat` (IPC channel `IPC_CHANNELS.AGENT_CHAT`).
  - Slash command handlers:
    - `/model <name>`: Switches current model on 9router.
    - `/token <key>`: Connects and persists 9router API key.
    - `/tools`: Displays all registered toolsets and individual tools.
    - `/skills`: Lists loaded skills categorized.
    - `/themes`: Lists all available themes with active marked.
    - `/theme <name>`: Switches theme instantly.
    - `/stats`: Shows live telemetry, tokens, latency, and session stats.
    - `/memory`: Inspects persistent MEMORY.md content.
    - `/todos`: Inspects active in-memory task list.
    - `/sessions`: Lists saved chat sessions.
    - `/resume <id>`: Resumes previous chat session.
    - `/stop`: Interrupts active running agent turn.
    - `/pty` or `/sh`: Switches to Direct PTY Shell Mode (hotkey: `Ctrl+\`` or `Ctrl+T`).
    - `/new` or `/reset`: Resets agent conversation history.
    - `/clear`: Clears xterm.js screen.
    - `/help`: Displays command overview.
  - Live progress broadcasting via `mainWindow.webContents.send(IPC_CHANNELS.AGENT_STATUS)`.
- `preload/index.ts`: Exposes secure context bridge API (`window.api`) to renderer.
- `renderer/main.ts`:
  - Terminal creation (`Terminal` from `@xterm/xterm`, `FitAddon`).
  - Chat input events (`Enter` triggers message send).
  - Status updates (`onAgentStatus` listener renders `  ┊` tool traces in real time).
  - Symmetrical response container formatting with `╭─ ☤ Vallenatrix ───╮`.
  - Global shortcuts (`Ctrl+Shift+R` to reload UI).
- `shared/channels.ts`: Channel name constants.
- `shared/types.ts`: Theme configurations and schema types.

## Hardware & Graphics Drivers (Intel GMA 4500MHD)

- Intel Mobile 4 Series Chipsets hang under default Debian `iHD` VA-API driver.
- Environment override required: `LIBVA_DRIVER_NAME=i965` or `--disable-features=VaapiVideoDecoder,VaapiVideoEncoder`.

## Common Commands

```bash
# Build Vite bundles (main, preload, renderer)
npm run build

# Start Electron application
npm start

# Development mode with hot reload
npm run dev
```
