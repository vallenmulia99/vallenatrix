import test from 'node:test'
import assert from 'node:assert/strict'
import { registry } from '../dist/tools.js'

test('tool registry coerces pure numeric strings before integer validation', async () => {
  const name = 'test_numeric_string_integer'
  let received
  registry.register({
    name,
    toolset: 'test',
    schema: { name, description: name, parameters: { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'] } },
    handler: async args => { received = args.count; return String(args.count) }
  })
  const args = { count: '5' }
  assert.equal(await registry.execute(name, args), '5')
  assert.equal(received, 5)
  assert.equal(args.count, '5')
})
