import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registry } from '../dist/tools.js'
import { registerBuiltinTools } from '../dist/builtin_tools.js'
import { formatToolEnd, formatUnifiedDiff } from '../dist/display.js'

 test('write_file refuses existing files without a complete current read', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'vallenatrix-write-guard-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  registerBuiltinTools(undefined, undefined, undefined, undefined, false)
  const path = join(dir, 'target.txt')
  writeFileSync(path, 'original')
  const context = { workingDir: dir, fileReadCoverage: new Map() }

  const unread = JSON.parse(await registry.execute('write_file', { path, content: 'overwrite' }, context))
  assert.match(unread.error, /read_file/i)
  assert.equal(readFileSync(path, 'utf8'), 'original')

  await registry.execute('read_file', { path }, context)
  writeFileSync(path, 'changed outside agent')
  const stale = JSON.parse(await registry.execute('write_file', { path, content: 'overwrite' }, context))
  assert.match(stale.error, /changed since.*read/i)
  assert.equal(readFileSync(path, 'utf8'), 'changed outside agent')

  await registry.execute('read_file', { path }, context)
  const fresh = JSON.parse(await registry.execute('write_file', { path, content: 'overwrite' }, context))
  assert.equal(fresh.success, true)
  assert.equal(readFileSync(path, 'utf8'), 'overwrite')
  const nextWrite = JSON.parse(await registry.execute('write_file', { path, content: 'second write' }, context))
  assert.equal(nextWrite.success, true)

  const pagedPath = join(dir, 'paged.txt')
  writeFileSync(pagedPath, Array.from({ length: 2_001 }, (_, i) => `line-${i}`).join('\n'))
  const pagedContext = { workingDir: dir, fileReadCoverage: new Map() }
  await registry.execute('read_file', { path: pagedPath, offset: 1, limit: 2_000 }, pagedContext)
  const partial = JSON.parse(await registry.execute('write_file', { path: pagedPath, content: 'blocked' }, pagedContext))
  assert.match(partial.error, /complete current file/i)
  await registry.execute('read_file', { path: pagedPath, offset: 2_001, limit: 2_000 }, pagedContext)
  const pagedWrite = JSON.parse(await registry.execute('write_file', { path: pagedPath, content: 'allowed' }, pagedContext))
  assert.equal(pagedWrite.success, true)
})

test('write_file atomically replaces and verifies while preserving mode', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'vallenatrix-write-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  registerBuiltinTools(undefined, undefined, undefined, undefined, false)
  const path = join(dir, 'target.txt')
  writeFileSync(path, 'previous')
  chmodSync(path, 0o640)
  const context = { workingDir: dir, fileReadCoverage: new Map() }
  await registry.execute('read_file', { path }, context)
  const result = JSON.parse(await registry.execute('write_file', { path, content: 'replacement' }, context))
  assert.equal(result.success, true)
  assert.equal(result.verified, true)
  assert.equal(readFileSync(path, 'utf8'), 'replacement')
  assert.match(result.diff, /--- a\/.*target\.txt/)
  assert.match(result.diff, /\n-previous\n\+replacement/)
  assert.equal((await import('node:fs')).statSync(path).mode & 0o777, 0o640)
})

test('write_file keeps previous destination when temp write fails', async (t) => {
  const { mkdirSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'vallenatrix-write-failure-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  registerBuiltinTools(undefined, undefined, undefined, undefined, false)
  const path = join(dir, 'target.txt')
  writeFileSync(path, 'previous')
  const context = { workingDir: dir, fileReadCoverage: new Map() }
  await registry.execute('read_file', { path }, context)
  mkdirSync(`${path}.tmp-${process.pid}`)
  const result = JSON.parse(await registry.execute('write_file', { path, content: 'replacement' }, context))
  assert.match(result.error, /EISDIR/)
  assert.equal(readFileSync(path, 'utf8'), 'previous')
})

test('write_file omits unchanged diff and explains when diff cannot be produced', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'vallenatrix-write-diff-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  registerBuiltinTools(undefined, undefined, undefined, undefined, false)
  const context = { workingDir: dir, fileReadCoverage: new Map() }
  const unchangedPath = join(dir, 'same.txt')
  writeFileSync(unchangedPath, 'same')
  await registry.execute('read_file', { path: unchangedPath }, context)
  const unchanged = JSON.parse(await registry.execute('write_file', { path: unchangedPath, content: 'same' }, context))
  assert.equal(unchanged.success, true)
  assert.equal(unchanged.diff, undefined)
  assert.match(unchanged.diff_omitted, /unchanged/i)

  const created = JSON.parse(await registry.execute('write_file', { path: join(dir, 'created.txt'), content: 'new' }))
  assert.equal(created.success, true)
  assert.match(created.diff, /\+new/)
  assert.doesNotMatch(created.diff, /^-[^-]/m)
  assert.match(created.diff, /\+\+\+ b\/.*created\.txt/)
  assert.equal(created.diff_omitted, undefined)
  assert.ok(formatUnifiedDiff(created.diff).includes('\x1b[97;42m+new\x1b[0m'))

  const binaryPath = join(dir, 'binary.dat')
  const binaryBytes = Buffer.from([0, 1, 2, 3])
  writeFileSync(binaryPath, binaryBytes)
  const binary = JSON.parse(await registry.execute('write_file', { path: binaryPath, content: 'text' }, context))
  assert.match(binary.error, /binary/i)
  assert.deepEqual(readFileSync(binaryPath), binaryBytes)

  const largePath = join(dir, 'large.txt')
  writeFileSync(largePath, 'old')
  await registry.execute('read_file', { path: largePath }, context)
  const largeContent = Array.from({ length: 2_000 }, (_, i) => `line-${String(i).padStart(4, '0')}`).join('\n')
  const large = JSON.parse(await registry.execute('write_file', { path: largePath, content: largeContent }, context))
  assert.equal(large.diff_truncated, true)
  assert.ok(large.diff.length <= 20_000)
  assert.ok(large.diff.split('\n').length <= 120)
  assert.ok(large.diff_omitted_lines > 0)
  assert.match(large.diff, /line-0000/)
  assert.match(formatUnifiedDiff(large.diff), /more lines/)
  assert.match(formatToolEnd('write_file', { path: largePath }, JSON.stringify(large)), /more diff lines not sent to model/)

  const longLine = JSON.parse(await registry.execute('write_file', {
    path: join(dir, 'long-line.txt'),
    content: 'z'.repeat(25_000)
  }))
  assert.equal(longLine.diff_truncated, true)
  assert.ok(longLine.diff.length <= 20_000)
  assert.match(longLine.diff, /\+z{20}/)
})
