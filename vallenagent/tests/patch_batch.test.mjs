import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registry } from '../dist/tools.js'
import { SkillLoader } from '../dist/skills.js'
import { registerBuiltinTools } from '../dist/builtin_tools.js'

function setup(dir) {
  registerBuiltinTools(new SkillLoader([dir]), undefined, undefined, undefined, false)
}

test('patch_batch preflights all files before writing any', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'patch-batch-'))
  const first = join(dir, 'first.txt')
  const second = join(dir, 'second.txt')
  writeFileSync(first, 'alpha\n')
  writeFileSync(second, 'beta\n')
  setup(dir)
  const result = JSON.parse(await registry.execute('patch_batch', { files: [
    { path: first, old_string: 'alpha', new_string: 'changed' },
    { path: second, old_string: 'missing', new_string: 'changed' }
  ] }, { workingDir: dir }))
  assert.ok(result.error)
  assert.equal(readFileSync(first, 'utf8'), 'alpha\n')
  assert.equal(readFileSync(second, 'utf8'), 'beta\n')
})

test('patch_batch applies all valid unique replacements', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'patch-batch-'))
  const paths = [join(dir, 'a.txt'), join(dir, 'b.txt')]
  writeFileSync(paths[0], 'alpha\n')
  writeFileSync(paths[1], 'beta\n')
  setup(dir)
  const result = JSON.parse(await registry.execute('patch_batch', { files: [
    { path: paths[0], old_string: 'alpha', new_string: 'first' },
    { path: paths[1], old_string: 'beta', new_string: 'second' }
  ] }, { workingDir: dir }))
  assert.equal(result.success, true)
  assert.deepEqual(paths.map(path => readFileSync(path, 'utf8')), ['first\n', 'second\n'])
})

test('apply_patch rejects repeated path sections and preserves files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'patch-batch-'))
  const file = join(dir, 'config.js')
  writeFileSync(file, 'const radius = 70\n')
  setup(dir)
  const patch = `*** Begin Patch
*** Update File: ${file}
@@
-const radius = 70
+const radius = 86
*** Update File: ${file}
@@
-const radius = 86
+const radius = 90
*** End Patch`
  const result = JSON.parse(await registry.execute('apply_patch', { patch }, { workingDir: dir }))
  assert.match(result.error, /Duplicate file section/)
  assert.equal(readFileSync(file, 'utf8'), 'const radius = 70\n')
})

test('apply_patch returns unified diff with removed and added lines', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'patch-batch-'))
  const file = join(dir, 'config.js')
  writeFileSync(file, 'const radius = 70\n')
  setup(dir)
  const patch = `*** Begin Patch
*** Update File: ${file}
@@
-const radius = 70
+const radius = 86
*** End Patch`
  const result = JSON.parse(await registry.execute('apply_patch', { patch }, { workingDir: dir }))
  assert.equal(result.success, true)
  assert.match(result.diff, /-const radius = 70[\s\S]*\+const radius = 86/)
})

test('apply_patch accepts distinct path sections in one patch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'patch-batch-'))
  const first = join(dir, 'first.js')
  const second = join(dir, 'second.js')
  writeFileSync(first, 'const radius = 70\n')
  writeFileSync(second, 'function fireUltimate() {}\n')
  setup(dir)
  const patch = `*** Begin Patch
*** Update File: ${first}
@@
-const radius = 70
+const radius = 86
*** Update File: ${second}
@@
-function fireUltimate() {}
+function fireUltimate() { return true }
*** End Patch`
  const result = JSON.parse(await registry.execute('apply_patch', { patch }, { workingDir: dir }))
  assert.equal(result.success, true)
  assert.equal(readFileSync(first, 'utf8'), 'const radius = 86\n')
  assert.equal(readFileSync(second, 'utf8'), 'function fireUltimate() { return true }\n')
  assert.match(result.diff, /-const radius = 70[\s\S]*\+const radius = 86/)
  assert.match(result.diff, /-function fireUltimate\(\) \{\}[\s\S]*\+function fireUltimate\(\) \{ return true \}/)
})
