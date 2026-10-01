import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { existsSync, unlinkSync, rmdirSync } from 'node:fs'
import { registry } from '../dist/tools.js'
import { SkillLoader } from '../dist/skills.js'
import { registerBuiltinTools, fuzzyReplace } from '../dist/builtin_tools.js'

test('Fuzzy Replace - 9 strategies', async (t) => {
  // 1. Exact
  const t1 = fuzzyReplace('hello world', 'world', 'vallen')
  assert.equal(t1.content, 'hello vallen')
  assert.equal(t1.strategy, 'exact')

  // 2. Line trimmed
  const t2 = fuzzyReplace('line 1  \n  line 2  ', 'line 1\nline 2', 'line 1\nline edited')
  assert.equal(t2.strategy, 'line_trimmed')

  // 3. Whitespace normalized
  const t3 = fuzzyReplace('const   res   =   func(a,   b)', 'const res = func(a, b)', 'const res = func(a, c)')
  assert.equal(t3.strategy, 'whitespace_normalized')

  // 4. Indentation flexible / line trimmed
  const t4 = fuzzyReplace('    const x = 1\n    const y = 2', 'const x = 1\nconst y = 2', 'const x = 10\nconst y = 20')
  assert.ok(['line_trimmed', 'indentation_flexible'].includes(t4.strategy))

  // 5. Escape normalized (pattern with escaped chars matching real newlines)
  const t5 = fuzzyReplace('const str = "foo\nbar"', 'const str = "foo\\nbar"', 'const str = "baz"')
  assert.equal(t5.strategy, 'escape_normalized')

  // 6. Trimmed boundary
  const t6 = fuzzyReplace('  head\nbody 1\nbody 2\n  tail  ', 'head\nbody 1\nbody 2\ntail', 'head\nbody 1\nbody edited\ntail')
  assert.ok(['line_trimmed', 'trimmed_boundary'].includes(t6.strategy))

  // 7. Unicode normalized
  const t7 = fuzzyReplace('“hello” – ‘world’', '"hello" - \'world\'', '"hello" - "vallen"')
  assert.equal(t7.strategy, 'unicode_normalized')

  // 8. Block anchor
  const t8 = fuzzyReplace('start_tag\nmiddle line different\nend_tag', 'start_tag\nmiddle line\nend_tag', 'start_tag\nmiddle updated\nend_tag')
  assert.equal(t8.strategy, 'block_anchor')
})

test('Core Tools execution via registry', async (t) => {
  const skillsDir = '/home/vallenganteng/Destop/vallenatrix/.vallenatrix/skills'
  const loader = new SkillLoader([skillsDir])
  loader.load()
  registerBuiltinTools(loader)

  // Verify tools registered
  const schemas = registry.getSchemas()
  const toolNames = schemas.map(s => s.name)
  assert.ok(toolNames.includes('read_file'))
  assert.ok(toolNames.includes('write_file'))
  assert.ok(toolNames.includes('patch'))
  assert.ok(toolNames.includes('search_files'))
  assert.ok(toolNames.includes('terminal'))
  assert.ok(toolNames.includes('skill_view'))
  assert.ok(toolNames.includes('skills_list'))

  // Test write_file
  const testFile = '/tmp/vallenagent_test.txt'
  const writeRes = JSON.parse(await registry.execute('write_file', { path: testFile, content: 'alpha\nbeta\ngamma\ndelta' }))
  assert.equal(writeRes.success, true)
  assert.equal(writeRes.verified, true)

  // Test read_file
  const readRes = JSON.parse(await registry.execute('read_file', { path: testFile, offset: 2, limit: 2 }))
  assert.equal(readRes.offset, 2)
  assert.ok(readRes.content.includes('2|beta'))
  assert.ok(readRes.content.includes('3|gamma'))
  assert.equal(readRes.content.includes('1|alpha'), false)

  // Test patch
  const patchRes = JSON.parse(await registry.execute('patch', { path: testFile, old_string: 'beta', new_string: 'beta_patched' }))
  assert.equal(patchRes.success, true)
  const verifyRead = JSON.parse(await registry.execute('read_file', { path: testFile }))
  assert.ok(verifyRead.content.includes('beta_patched'))

  // Test terminal
  const termRes = JSON.parse(await registry.execute('terminal', { command: 'echo "vallenatrix online"' }))
  assert.equal(termRes.exit_code, 0)
  assert.equal(termRes.output, 'vallenatrix online')

  // Test skills_list & skill_view
  const listRes = JSON.parse(await registry.execute('skills_list', {}))
  assert.ok(listRes.length > 0)
  const vallenSkill = listRes.find(s => s.name === 'vallenatrix')
  assert.ok(vallenSkill, 'vallenatrix skill should be registered and listed')

  const viewRes = JSON.parse(await registry.execute('skill_view', { name: 'vallenatrix' }))
  assert.equal(viewRes.name, 'vallenatrix')
  assert.ok(viewRes.content.includes('Vallenatrix'))

  // Cleanup
  if (existsSync(testFile)) unlinkSync(testFile)
})
