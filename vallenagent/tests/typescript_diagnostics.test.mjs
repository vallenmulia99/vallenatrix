import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { captureTypeScriptDiagnostics, newTypeScriptDiagnostics } from '../dist/typescript_diagnostics.js'
import { registerBuiltinTools } from '../dist/builtin_tools.js'
import { registry } from '../dist/tools.js'

test('reports only TypeScript diagnostics introduced by a file edit', t => {
  const root = mkdtempSync(join(process.cwd(), '.ts-diagnostics-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['src/**/*.ts'] }))
  const file = join(root, 'src', 'feature.ts')
  writeFileSync(file, 'export const answer: number = 42\n')

  const before = captureTypeScriptDiagnostics(file, root)
  assert.ok(before)
  assert.equal(before.size, 0)
  writeFileSync(file, "export const answer: number = 'wrong'\n")
  const after = captureTypeScriptDiagnostics(file, root)
  const diagnostics = newTypeScriptDiagnostics(before, after)
  assert.match(diagnostics, /TS2322/)
})

test('does not report unchanged baseline diagnostics', () => {
  const baseline = new Map([['TS2322:1:bad', 'ERROR [1:1] TS2322: bad']])
  assert.equal(newTypeScriptDiagnostics(baseline, baseline), undefined)
})

test('write_file returns new TypeScript diagnostics to the agent', async t => {
  const root = mkdtempSync(join(process.cwd(), '.ts-write-diagnostics-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['src/**/*.ts'] }))
  const file = join(root, 'src', 'feature.ts')
  writeFileSync(file, 'export const answer: number = 42\n')
  registerBuiltinTools(null, null, null, undefined, false)
  const context = { workingDir: root, fileReadCoverage: new Map() }
  await registry.execute('read_file', { path: file }, context)
  const result = JSON.parse(await registry.execute('write_file', { path: file, content: "export const answer: number = 'wrong'\n" }, context))
  assert.equal(result.success, true)
  assert.match(result.lsp_diagnostics, /TS2322/)
})

test('patch returns new TypeScript diagnostics to the agent', async t => {
  const root = mkdtempSync(join(process.cwd(), '.ts-patch-diagnostics-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['src/**/*.ts'] }))
  const file = join(root, 'src', 'feature.ts')
  writeFileSync(file, 'export const answer: number = 42\n')
  registerBuiltinTools(null, null, null, undefined, false)
  const context = { workingDir: root }
  const result = JSON.parse(await registry.execute('patch', { path: file, old_string: '42', new_string: "'wrong'" }, context))
  assert.equal(result.success, true)
  assert.match(result.lsp_diagnostics, /TS2322/)
})
