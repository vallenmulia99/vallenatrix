---
name: vallenatrix
description: "Use, configure, theme, extend, and orchestrate Vallenatrix."
version: 1.0.0
author: Vallen + Vallenatrix Team
license: MIT
platforms: [linux]
metadata:
  vallenatrix:
    tags: [vallenatrix, terminal, agent, transparent, anime, electron, skills, tools]
    related_skills: [hermes-agent, claude-code]
---

# Vallenatrix

Vallenatrix is a custom transparent Linux Electron terminal emulator with anime/media background, customizable themes, interactive pixel pet, and integrated autonomous AI Agent powered by OpenAI-compatible models (e.g. 9router / Gemini / Claude / local LLM).

## Features

- **Transparent UI & Media Background** — Electron borderless window with configurable opacity, blur, video/image anime backgrounds, and custom color themes.
- **Embedded xterm.js & node-pty** — Full Linux terminal emulation with clipboard support, font size scaling, and resize handling.
- **Built-in AI Agent (Vallen Agent)** — Integrated Hermes-inspired tool calling loop supporting core file tools (`read_file`, `write_file`, `patch`, `search_files`), shell execution (`terminal`), and dynamic skill loading (`skill_view`, `skills_list`).
- **Dynamic Skills Engine** — Modular skills in `.vallenatrix/skills/` scanned at startup. Available skills are indexed compactly in the prompt; full instructions load on demand via `skill_view`.
- **Interactive Pixel Pet Mascot** — Desktop companion rendered inside the terminal workspace.

## Quick Start

```bash
# Launch Vallenatrix
cd /home/vallenganteng/Destop/vallenatrix
npm -w vallenterminal run dev

# Or run via launcher script if installed
./install.sh
```

## Key Paths

```
~/.vallenatrix/config.json       Main settings (provider, model, terminal, themes)
~/.vallenatrix/skills/          Installed and custom skills (SKILL.md format)
~/.vallenatrix/themes/          Theme color definitions
/home/vallenganteng/Destop/vallenatrix/vallenterminal/  Electron frontend app
/home/vallenganteng/Destop/vallenatrix/vallenagent/     Agent core & tools
```

## Available Tools

- `read_file(path, offset, limit)`: Read text file with 1-indexed line numbers and 100K char truncation.
- `write_file(path, content)`: Overwrite file contents and ensure directories exist.
- `patch(path, old_string, new_string, replace_all)`: Find-and-replace using 9-tier fuzzy matching and return unified diff.
- `search_files(pattern, target, path, file_glob, limit, offset)`: Search file contents (regex/grep) or filenames (glob).
- `terminal(command, timeout, workdir)`: Execute shell commands and capture stdout/stderr.
- `skill_view(name, file_path)`: Load full skill instructions and linked documents.
- `skills_list(category)`: List all loaded skills.
