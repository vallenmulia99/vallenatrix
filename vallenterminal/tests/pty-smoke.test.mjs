import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node-pty'

test('native PTY supports shell exit and a subsequent shell spawn', { skip: process.platform === 'win32' }, async () => {
  async function runShell(exitCode) {
    const child = spawn('/bin/sh', ['-c', `exit ${exitCode}`], {
      name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd(), env: process.env
    })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('PTY exit timed out')) }, 5000)
      child.onExit(({ exitCode: actual }) => { clearTimeout(timer); resolve(actual) })
    })
  }
  assert.equal(await runShell(7), 7)
  assert.equal(await runShell(0), 0)
})
