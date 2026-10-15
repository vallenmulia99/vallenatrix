import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registry } from '../dist/tools.js'
import { SkillLoader } from '../dist/skills.js'
import { registerBuiltinTools } from '../dist/builtin_tools.js'

test('patch_batch preflights all files before writing any', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'patch-batch-'))
  const first = join(dir, 'first.txt')
  const second = join(dir, 'second.txt')
  writeFileSync(first, 'alpha\n')
  writeFileSync(second, 'beta\n')
  registerBuiltinTools(new SkillLoader([dir]), undefined, undefined, undefined, false)
  const result = JSON.parse(await registry.execute('patch_batch', { files: [
    { path: first, old_string: 'alpha', new_string: 'changed' },
    { path: second, old_string: 'missing', new_string: 'changed' }
  ] }))
  assert.ok(result.error)
  assert.equal(readFileSync(first, 'utf8'), 'alpha\n')
  assert.equal(readFileSync(second, 'utf8'), 'beta\n')
})

test('patch_batch applies all valid unique replacements', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'patch-batch-'))
  const paths = [join(dir, 'a.txt'), join(dir, 'b.txt')]
  writeFileSync(paths[0], 'alpha\n')
  writeFileSync(paths[1], 'beta\n')
  registerBuiltinTools(new SkillLoader([dir]), undefined, undefined, undefined, false)
  const result = JSON.parse(await registry.execute('patch_batch', { files: [
    { path: paths[0], old_string: 'alpha', new_string: 'first' },
    { path: paths[1], old_string: 'beta', new_string: 'second' }
  ] }))
  assert.equal(result.success, true)
  assert.deepEqual(paths.map(path => readFileSync(path, 'utf8')), ['first\n', 'second\n'])
})
