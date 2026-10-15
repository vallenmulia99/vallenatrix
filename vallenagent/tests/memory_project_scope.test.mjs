import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../dist/memory.js'

test('project memory is isolated by cwd while user profile remains global', async t => {
  const base = mkdtempSync(join(tmpdir(), 'memory-project-scope-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  process.env.VALLENATRIX_HOME = base
  const projectA = new MemoryStore(undefined, '/projects/alpha')
  const projectB = new MemoryStore(undefined, '/projects/beta')
  await projectA.add('memory', 'Project alpha uses pnpm.')
  await projectA.add('user', 'User prefers concise replies.')
  assert.match(projectA.formatForSystemPrompt(), /Project alpha uses pnpm/)
  assert.doesNotMatch(projectB.formatForSystemPrompt(), /Project alpha uses pnpm/)
  assert.match(projectB.formatForSystemPrompt(), /User prefers concise replies/)
})
