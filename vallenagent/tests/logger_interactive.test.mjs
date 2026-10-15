import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

test('interactive logger writes warnings and errors to private log instead of console', t => {
  const home = mkdtempSync(join(tmpdir(), 'interactive-logger-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const probe = `const {logger}=require('./dist/logger.js'); logger.warn('warning-line'); logger.error('error-line')`
  const result = spawnSync(process.execPath, ['-e', probe], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
    env: { ...process.env, VALLENATRIX_HOME: home, VALLENATRIX_INTERACTIVE: '1', VALLENATRIX_LOG: 'warn' }
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout + result.stderr, '')
  const logPath = join(home, 'logs', 'agent.log')
  const content = readFileSync(logPath, 'utf8')
  assert.match(content, /warning-line/)
  assert.match(content, /error-line/)
  assert.equal(statSync(logPath).mode & 0o777, 0o600)
})
