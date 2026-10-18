import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIAgent } from '../dist/agent.js'
import { registry } from '../dist/tools.js'

test('terminal returns error for nonexistent working directory', async t => {
  const home = mkdtempSync(join(tmpdir(), 'vallenatrix-c3-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  process.env.VALLENATRIX_HOME = home
  new AIAgent({ isSubagent: true })
  const result = JSON.parse(await registry.execute('terminal', { command: 'echo hi', workdir: join(home, 'missing') }))
  assert.equal(result.exit_code, 1)
  assert.match(result.error, /Working directory does not exist/)
})

test('terminal persists chained cd even when invocation has explicit workdir', async t => {
  const home = mkdtempSync(join(tmpdir(), 'vallenatrix-c3-cd-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  process.env.VALLENATRIX_HOME = home
  new AIAgent({ isSubagent: true })
  const startDir = join(home, 'start')
  const nextDir = join(home, 'next')
  mkdirSync(startDir)
  mkdirSync(nextDir)
  const context = { workingDir: home }
  const result = JSON.parse(await registry.execute('terminal', {
    command: `cd ${nextDir} && pwd`, workdir: startDir
  }, context))
  assert.equal(result.exit_code, 0)
  assert.equal(result.cwd, nextDir)
  assert.equal(context.workingDir, nextDir)
})
