import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registry } from '../dist/tools.js'
import { SkillLoader } from '../dist/skills.js'
import { registerBuiltinTools } from '../dist/builtin_tools.js'

test('apply_patch applies V4A update hunks across files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'v4a-patch-'))
  writeFileSync(join(dir, 'a.txt'), 'alpha\nkeep\n')
  writeFileSync(join(dir, 'b.txt'), 'beta\nkeep\n')
  registerBuiltinTools(new SkillLoader([dir]), undefined, undefined, undefined, false)
  const patch = `*** Begin Patch\n*** Update File: a.txt\n@@\n-alpha\n+first\n keep\n*** Update File: b.txt\n@@\n-beta\n+second\n keep\n*** End Patch`
  const result = JSON.parse(await registry.execute('apply_patch', { patch }, { workingDir: dir }))
  assert.equal(result.success, true)
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'first\nkeep\n')
  assert.equal(readFileSync(join(dir, 'b.txt'), 'utf8'), 'second\nkeep\n')
})

test('apply_patch adds and deletes files in the same patch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'apply-patch-files-'))
  const deleted = join(dir, 'remove.txt')
  const added = join(dir, 'new.txt')
  writeFileSync(deleted, 'remove this\n')
  try {
    const result = await registry.execute('apply_patch', { patch: `*** Begin Patch\n*** Delete File: ${deleted}\n*** Add File: ${added}\n+created\n*** End Patch` }, { workingDir: dir })
    assert.equal(JSON.parse(result).success, true)
    assert.equal(existsSync(deleted), false)
    assert.equal(readFileSync(added, 'utf8'), 'created')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('apply_patch rejects malformed patches without modifying files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'v4a-patch-'))
  const file = join(dir, 'a.txt')
  writeFileSync(file, 'alpha\n')
  registerBuiltinTools(new SkillLoader([dir]), undefined, undefined, undefined, false)
  const result = JSON.parse(await registry.execute('apply_patch', { patch: '*** Begin Patch\n*** Update File: a.txt\n@@\n-wrong\n+changed\n*** End Patch' }, { workingDir: dir }))
  assert.ok(result.error)
  assert.equal(readFileSync(file, 'utf8'), 'alpha\n')
})
