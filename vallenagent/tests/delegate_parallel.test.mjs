import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registry } from '../dist/tools.js'
import { SkillLoader } from '../dist/skills.js'
import { registerBuiltinTools } from '../dist/builtin_tools.js'

test('delegate_task runs tasks with concurrency capped at three and preserves result order', async () => {
  const loader = new SkillLoader([mkdtempSync(join(tmpdir(), 'delegate-parallel-'))])
  let active = 0
  let maximum = 0
  registerBuiltinTools(loader, undefined, undefined, undefined, false)
  const result = JSON.parse(await registry.execute('delegate_task', {
    tasks: Array.from({ length: 7 }, (_, i) => ({ goal: `task-${i}` }))
  }, {
    delegateAgentFactory: async goal => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, 15))
      active--
      return goal
    }
  }))
  assert.equal(maximum, 3)
  assert.deepEqual(result.results.map(item => item.goal), Array.from({ length: 7 }, (_, i) => `task-${i}`))
  assert.deepEqual(result.results.map(item => item.summary), Array.from({ length: 7 }, (_, i) => `task-${i}`))
})

test('delegate_task keeps per-task failures while continuing other tasks', async () => {
  const loader = new SkillLoader([mkdtempSync(join(tmpdir(), 'delegate-failure-'))])
  registerBuiltinTools(loader, undefined, undefined, undefined, false)
  const result = JSON.parse(await registry.execute('delegate_task', {
    tasks: [{ goal: 'first' }, { goal: 'broken' }, { goal: 'last' }]
  }, {
    delegateAgentFactory: async goal => {
      if (goal === 'broken') throw new Error('expected failure')
      return goal
    }
  }))
  assert.equal(result.results[0].summary, 'first')
  assert.equal(result.results[1].summary, 'Subagent failed: expected failure')
  assert.equal(result.results[2].summary, 'last')
})
