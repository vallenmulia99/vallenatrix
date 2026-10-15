import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIAgent } from '../dist/agent.js'

test('subagent config and terminal state are isolated from parent', t => {
  const home = mkdtempSync(join(tmpdir(), 'subagent-config-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  process.env.VALLENATRIX_HOME = home
  const parent = new AIAgent({ isSubagent: true })
  parent.config.terminal.cwd = '/parent/project'
  const child = new AIAgent({ config: parent.config, isSubagent: true })
  child.config.terminal.cwd = '/child/project'
  assert.notEqual(child.config, parent.config)
  assert.notEqual(child.config.terminal, parent.config.terminal)
  assert.equal(parent.config.terminal.cwd, '/parent/project')
})
