import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../dist/memory.js'
import { handleCommand } from '../dist/commands.js'

test('terminal /memory command lists, adds, replaces, and removes user/project entries', async t => {
  const base = mkdtempSync(join(tmpdir(), 'memory-command-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const agent = { memoryStore: new MemoryStore(join(base, 'memories'), '/projects/alpha') }
  const ctx = { channel: 'terminal', agent }
  assert.match((await handleCommand(ctx, '/memory add project Alpha uses npm.')).response, /disimpan/i)
  assert.match((await handleCommand(ctx, '/memory add user Prefers concise answers.')).response, /disimpan/i)
  const listing = await handleCommand(ctx, '/memory')
  assert.match(listing.response, /Alpha uses npm/)
  assert.match(listing.response, /Prefers concise answers/)
  assert.match((await handleCommand(ctx, '/memory replace project Alpha uses npm => Alpha uses pnpm')).response, /diperbarui/i)
  assert.match((await handleCommand(ctx, '/memory remove user Prefers concise answers')).response, /dihapus/i)
  assert.doesNotMatch(agent.memoryStore.formatForSystemPrompt(), /Alpha uses npm|Prefers concise answers/)
  assert.match(agent.memoryStore.formatForSystemPrompt(), /Alpha uses pnpm/)
})
