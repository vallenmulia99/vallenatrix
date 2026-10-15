import test from 'node:test'
import assert from 'node:assert/strict'
import { gradeModelProbe, MODEL_PROBES, runModelEval } from '../dist/model_eval.js'
import { createMockProviderServer } from './helpers/mock_provider_server.mjs'
import { OpenAICompatibleProvider } from '../dist/providers.js'

const answer = text => ({ id: 'mock', model: 'mock', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }] })

test('model probes grade text, structured tool calls, and stream output', () => {
  assert.equal(MODEL_PROBES.length, 3)
  assert.equal(gradeModelProbe('text', answer('VALLENATRIX_EVAL_OK')), true)
  assert.equal(gradeModelProbe('text', answer('almost VALLENATRIX_EVAL_OK')), false)
  assert.equal(gradeModelProbe('tool_call', { choices: [{ message: { tool_calls: [{ function: { name: 'report_result', arguments: '{"value":"VALLENATRIX_TOOL_OK"}' } }] } }] }), true)
  assert.equal(gradeModelProbe('tool_call', { choices: [{ message: { tool_calls: [{ function: { name: 'report_result', arguments: '{bad json' } }] } }] }), false)
  assert.equal(gradeModelProbe('stream', answer('VALLENATRIX_STREAM_OK'), 'VALLENATRIX_STREAM_OK'), true)
  assert.equal(gradeModelProbe('unknown', answer('x')), false)
})

test('model eval records pass/fail per probe without executing model tool calls', async () => {
  const server = await createMockProviderServer([
    { body: answer('VALLENATRIX_EVAL_OK') },
    { body: {
      id: 'mock', model: 'mock',
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant', content: '',
          tool_calls: [{
            id: 'call-1', type: 'function',
            function: { name: 'report_result', arguments: '{"value":"VALLENATRIX_TOOL_OK"}' }
          }]
        }
      }]
    } },
    { rawBody: 'data: {"choices":[{"delta":{"content":"VALLENATRIX_STREAM_OK"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n' }
  ])
  try {
    const provider = new OpenAICompatibleProvider('mock', server.url, '', 'mock')
    const report = await runModelEval(provider, { timeout: 2_000 })
    assert.equal(report.results.length, 3)
    assert.deepEqual(report.results.map(item => item.passed), [true, true, true])
    assert.equal(report.score, 3)
    assert.equal(server.requests.length, 3)
    assert.equal(server.requests[1].tools[0].function.name, 'report_result')
    assert.equal(server.requests[2].stream, true)
  } finally { await server.close() }
})
