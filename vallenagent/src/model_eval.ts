import { chmodSync, lstatSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getVallenatrixHome, loadConfig } from './config'
import { createProvider } from './providers'
import type { CompletionResponse, Provider } from './providers'

const EVAL_TEXT = 'VALLENATRIX_EVAL_OK'
const EVAL_TOOL = 'VALLENATRIX_TOOL_OK'
const EVAL_STREAM = 'VALLENATRIX_STREAM_OK'

export const MODEL_PROBES = [
  { name: 'text', prompt: `Reply with exactly ${EVAL_TEXT}.` },
  {
    name: 'tool_call',
    prompt: `Call report_result exactly once with value ${EVAL_TOOL}. Do not answer in plain text.`,
    tools: [{
      type: 'function',
      function: {
        name: 'report_result',
        description: 'Report the fixed benchmark value.',
        parameters: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false
        }
      }
    }]
  },
  { name: 'stream', prompt: `Reply with exactly ${EVAL_STREAM}.`, stream: true }
] as const

export function gradeModelProbe(name: string, response: CompletionResponse, streamed = ''): boolean {
  const message = response?.choices?.[0]?.message
  if (name === 'text') return (message?.content || '').trim() === EVAL_TEXT
  if (name === 'stream') return streamed.trim() === EVAL_STREAM
  if (name !== 'tool_call') return false
  const call = message?.tool_calls?.[0]
  if (call?.function?.name !== 'report_result') return false
  try {
    const args = JSON.parse(call.function.arguments)
    return args?.value === EVAL_TOOL && message.tool_calls?.length === 1
  } catch {
    return false
  }
}

export async function runModelEval(provider: Provider, options: { timeout?: number } = {}) {
  const results: Array<{ probe: string; passed: boolean; durationMs: number; error?: string }> = []
  for (const probe of MODEL_PROBES) {
    const started = Date.now()
    let streamed = ''
    try {
      const response = await provider.chat({
        model: provider.model,
        messages: [{ role: 'user', content: probe.prompt }],
        ...(probe.name === 'tool_call' ? { tools: [...probe.tools] } : {}),
        ...(probe.name === 'stream' ? { stream: true, onChunk: (chunk: string) => { streamed += chunk } } : {}),
        timeout: options.timeout ?? 30_000
      })
      results.push({ probe: probe.name, passed: gradeModelProbe(probe.name, response, streamed), durationMs: Date.now() - started })
    } catch (error) {
      results.push({ probe: probe.name, passed: false, durationMs: Date.now() - started, error: String(error).slice(0, 500) })
    }
  }
  return {
    provider: provider.name,
    model: provider.model,
    score: results.filter(result => result.passed).length,
    total: results.length,
    results
  }
}

function redactError(error: string, apiKey: string): string {
  return (apiKey ? error.replaceAll(apiKey, '[REDACTED]') : error).replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]').slice(0, 500)
}

export async function runConfiguredModelEval(args: string[]): Promise<void> {
  if (!args.includes('--confirm-live')) {
    console.log('Live model checks send 3 short requests per model and may incur API costs. Re-run with --confirm-live to proceed.')
    return
  }
  const providerFilter = args.find(arg => arg.startsWith('--provider='))?.slice('--provider='.length)
  const config = loadConfig()
  const providers = Object.entries(config.providers).filter(([name, value]) => {
    if (name === 'active' || typeof value === 'string' || !value.enabled) return false
    return !providerFilter || providerFilter === name
  }) as Array<[string, { base_url: string; api_key: string; model: string; enabled: boolean }]>
  if (providerFilter && !providers.some(([name]) => name === providerFilter)) {
    throw new Error(`Enabled provider not found: ${providerFilter}`)
  }
  if (!providers.length) throw new Error('No enabled provider configurations found')

  const reports = []
  for (const [name, config] of providers) {
    console.log(`Testing ${name}/${config.model} (3 short requests)...`)
    const provider = createProvider(name, config.base_url, config.api_key, config.model)
    const report = await runModelEval(provider)
    reports.push({ ...report, results: report.results.map(result => ({ ...result, ...(result.error ? { error: redactError(result.error, config.api_key) } : {}) })) })
    console.log(`${name}/${config.model}: ${report.score}/${report.total}`)
  }

  const directory = join(getVallenatrixHome(), 'evals')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const directoryStat = lstatSync(directory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('Eval report path must be a real directory')
  chmodSync(directory, 0o700)
  const reportPath = join(directory, `model-eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(reportPath, JSON.stringify({ createdAt: new Date().toISOString(), reports }, null, 2), { mode: 0o600, flag: 'wx' })
  console.log(`Report saved: ${reportPath}`)
}
