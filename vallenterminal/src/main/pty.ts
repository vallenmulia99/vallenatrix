import { spawn, IPty } from 'node-pty'
import { existsSync, readFileSync, accessSync, constants } from 'fs'
import { isAbsolute, join } from 'path'

function getValidShell(preferredShell: string): string {
  const defaultFallback = process.env.SHELL || '/bin/bash'

  if (!preferredShell || typeof preferredShell !== 'string') {
    return defaultFallback
  }

  // Must be an absolute path
  if (!isAbsolute(preferredShell)) {
    return defaultFallback
  }

  // Must exist and be executable
  try {
    accessSync(preferredShell, constants.X_OK)
  } catch {
    return defaultFallback
  }

  // Check /etc/shells if available on unix
  if (process.platform !== 'win32' && existsSync('/etc/shells')) {
    try {
      const shellsContent = readFileSync('/etc/shells', 'utf-8')
      const allowed = shellsContent
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
      if (!allowed.includes(preferredShell)) {
        return defaultFallback
      }
    } catch {
      // If /etc/shells unreadable, allow executable path
    }
  }

  return preferredShell
}

export class PtyManager {
  private ptyProcess: IPty | null = null

  spawn(
    shell: string,
    onData: (data: string) => void,
    onExit: (exitCode: number, signal?: number) => void
  ): IPty {
    this.kill()

    const chosenShell = getValidShell(shell)
    const cwd = process.env.HOME || process.cwd()

    this.ptyProcess = spawn(chosenShell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as Record<string, string>
    })

    // Send banner on startup
    setTimeout(() => {
      const bannerPath = join(process.cwd(), 'banner.txt')
      if (existsSync(bannerPath)) {
        try {
          const banner = readFileSync(bannerPath, 'utf-8')
          const coloredBanner = `\x1b[38;5;141m${banner}\x1b[0m\n\n`
          const credit = `\x1b[36m╭─────────────────────────────────────────────────────╮\x1b[0m
\x1b[36m│\x1b[0m  \x1b[1;35mVallenatrix\x1b[0m \x1b[90m-\x1b[0m AI Terminal dengan Gaya         \x1b[36m│\x1b[0m
\x1b[36m│\x1b[0m  Created by \x1b[33m@vallenganteng\x1b[0m                     \x1b[36m│\x1b[0m
\x1b[36m╰─────────────────────────────────────────────────────╯\x1b[0m\n\n`
          onData(coloredBanner + credit)
        } catch {
          // Ignore banner errors
        }
      }
    }, 100)

    this.ptyProcess.onData((data) => {
      onData(data)
    })

    this.ptyProcess.onExit(({ exitCode, signal }) => {
      this.ptyProcess = null
      onExit(exitCode, signal)
    })

    return this.ptyProcess
  }

  write(data: string): void {
    if (this.ptyProcess) {
      this.ptyProcess.write(data)
    }
  }

  resize(cols: number, rows: number): void {
    if (this.ptyProcess && cols > 0 && rows > 0) {
      try {
        this.ptyProcess.resize(cols, rows)
      } catch {
        // Ignore resize errors if pty is transitioning or dead
      }
    }
  }

  kill(): void {
    if (this.ptyProcess) {
      try {
        this.ptyProcess.kill()
      } catch {
        // Ignore kill errors
      }
      this.ptyProcess = null
    }
  }
}
