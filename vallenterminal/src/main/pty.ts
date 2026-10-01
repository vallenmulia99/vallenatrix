import { spawn, IPty } from 'node-pty'

export class PtyManager {
  private ptyProcess: IPty | null = null

  spawn(
    shell: string,
    onData: (data: string) => void,
    onExit: (exitCode: number, signal?: number) => void
  ): IPty {
    this.kill()

    const chosenShell = shell || process.env.SHELL || '/bin/bash'
    const cwd = process.env.HOME || process.cwd()

    this.ptyProcess = spawn(chosenShell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as Record<string, string>
    })

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
