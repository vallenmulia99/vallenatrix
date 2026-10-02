import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, unlinkSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registry } from '../dist/tools.js'
import { SkillLoader } from '../dist/skills.js'
import { MemoryStore } from '../dist/memory.js'
import { TodoStore } from '../dist/todo.js'
import { registerBuiltinTools } from '../dist/builtin_tools.js'

test('All Hermes Toolsets Registration & Execution', async (t) => {
  const testDir = mkdtempSync(join(tmpdir(), 'vallenagent-test-'))
  const loader = new SkillLoader([testDir])
  loader.load()

  const memory = new MemoryStore(join(testDir, 'memories'))
  const todo = new TodoStore()

  registerBuiltinTools(loader, memory, todo, async (goal) => `Subagent done: ${goal}`, false)

  const schemas = registry.getSchemas()
  const names = schemas.map(s => s.name)

  // Verify all toolsets present
  const requiredTools = [
    'read_file', 'write_file', 'patch', 'search_files', // file
    'terminal',                                          // terminal
    'execute_code',                                      // code_execution
    'web_search', 'web_extract',                         // web
    'clarify',                                           // clarify
    'memory',                                            // memory
    'todo_list',                                         // todo
    'image_generate',                                    // image_gen
    'browser_exec',                                      // browser-use
    'manage_connections',                                // connections
    'delegate_task',                                     // delegation
    'skill_manage', 'skill_view', 'skills_list'          // skills
  ]

  for (const tool of requiredTools) {
    assert.ok(names.includes(tool), `Tool ${tool} must be registered`)
  }

  // 1. Test execute_code
  const execRes = JSON.parse(await registry.execute('execute_code', { code: 'print("EXEC" + "_OK")' }))
  assert.equal(execRes.exit_code, 0)
  assert.ok(execRes.stdout.includes('EXEC_OK'))

  // 2. Test memory
  const memAdd = JSON.parse(await registry.execute('memory', { target: 'memory', action: 'add', content: 'Test note 1' }))
  assert.equal(memAdd.success, true)
  assert.ok(memory.formatForSystemPrompt().includes('Test note 1'))

  const memBatch = JSON.parse(await registry.execute('memory', {
    target: 'memory',
    operations: [
      { action: 'replace', old_text: 'Test note 1', content: 'Test note replaced' },
      { action: 'add', target: 'user', content: 'User prefers dark theme' }
    ]
  }))
  assert.equal(memBatch.success, true)
  assert.ok(memory.formatForSystemPrompt().includes('Test note replaced'))
  assert.ok(memory.formatForSystemPrompt().includes('User prefers dark theme'))

  // 3. Test todo_list
  const todoWrite = JSON.parse(await registry.execute('todo_list', {
    todos: [
      { id: '1', content: 'Build agent tools', status: 'in_progress' },
      { id: '2', content: 'Verify electron UI', status: 'pending' }
    ]
  }))
  assert.equal(todoWrite.active_count, 2)
  const todoInj = todo.formatForInjection()
  assert.ok(todoInj.includes('[>] 1. Build agent tools'))
  assert.ok(todoInj.includes('[ ] 2. Verify electron UI'))

  // 4. Test clarify
  const clarifyRes = JSON.parse(await registry.execute('clarify', {
    questions: [
      { question: 'Choose theme style', choices: ['dark', 'light'] }
    ]
  }))
  assert.equal(clarifyRes.clarification_needed, true)
  assert.equal(clarifyRes.responses[0].question, 'Choose theme style')

  // 5. Test manage_connections
  const connRes = JSON.parse(await registry.execute('manage_connections', {}))
  assert.equal(connRes.status, 'active')
  assert.ok(connRes.connectors['9router'])

  // 6. Test delegate_task
  const delRes = JSON.parse(await registry.execute('delegate_task', {
    tasks: [{ goal: 'Audit security rules' }]
  }))
  assert.ok(delRes.results[0].summary.includes('Audit security rules'))
})
