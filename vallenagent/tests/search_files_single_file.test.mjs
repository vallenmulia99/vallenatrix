import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registry } from '../dist/tools.js'
import { registerBuiltinTools } from '../dist/builtin_tools.js'

test('search_files with a single-file path returns content matches', async t => {
  const dir = mkdtempSync(join(process.cwd(), '.search-file-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'target.ts')
  writeFileSync(file, 'const alpha = 1\nconst beta = 2\nconst gamma = 3\n')
  registerBuiltinTools(null, null, null, undefined, false)

  const content = JSON.parse(await registry.execute('search_files', { pattern: 'beta', path: file }, { workingDir: dir }))
  assert.equal(content.total_count, 1)
  assert.equal(content.matches[0].line, 2)
  assert.match(content.matches[0].content, /beta/)

  const files = JSON.parse(await registry.execute('search_files', { pattern: '*.ts', target: 'files', path: file }, { workingDir: dir }))
  assert.equal(files.total_count, 1)

  const miss = JSON.parse(await registry.execute('search_files', { pattern: 'zzz', path: file }, { workingDir: dir }))
  assert.equal(miss.total_count, 0)
})
