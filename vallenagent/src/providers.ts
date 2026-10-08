// Model provider adapters - OpenAI compatible interface

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface CompletionRequest {
  model: string
  messages: Message[]
  tools?: any[]
  max_tokens?: number
  temperature?: number
  stream?: boolean
  signal?: AbortSignal  // BUG-18: Support abort
  onChunk?: (chunk: string) => void
  timeout?: number
}

export interface CompletionResponse {
  id: string
  model: string
  choices: Array<{
    message: Message
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface Provider {
  name: string
  baseURL: string
  apiKey: string
  model: string
  
  chat(request: CompletionRequest): Promise<CompletionResponse>
}

export class OpenAICompatibleProvider implements Provider {
  public baseURL: string

  constructor(
    public name: string,
    baseURL: string,
    public apiKey: string,
    public model: string
  ) {
    // Avoid IPv6 ::1 ECONNREFUSED on Linux/Electron
    this.baseURL = baseURL.replace('://localhost:', '://127.0.0.1:')
  }

  async chat(request: CompletionRequest): Promise<CompletionResponse> {
    const isStream = Boolean(request.stream && request.onChunk)

    const timeoutSignal = request.timeout ? AbortSignal.timeout(request.timeout) : undefined
    const signal = request.signal && timeoutSignal ? AbortSignal.any([request.signal, timeoutSignal]) : request.signal || timeoutSignal
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: request.model || this.model,
        messages: request.messages,
        tools: request.tools,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        stream: isStream,
        ...(isStream ? { stream_options: { include_usage: true } } : {})
      }),
      signal  // BUG-18: Pass abort signal
    })
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Provider API error: ${response.status} ${error}`)
    }

    if (!isStream || !response.body) {
      const data = await response.json()
      
      // BUG-09: Check for valid choices
      if (!data.choices || data.choices.length === 0) {
        const errorMsg = data.error ? JSON.stringify(data.error).slice(0, 500) : JSON.stringify(data).slice(0, 500)
        throw new Error(`Provider returned no choices: ${errorMsg}`)
      }

      return data as CompletionResponse
    }

    // Stream SSE reader
    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let fullContent = ''
    const toolCallsMap = new Map<string, { id: string; name: string; args: string }>()
    const toolCallIndexes = new Map<number, string>()
    const processLine = (rawLine: string) => {
      const line = rawLine.trim()
      if (!line || line.startsWith(':')) return
      const data = line.startsWith('data:') ? line.slice(5).trimStart() : ''
      if (!data || data === '[DONE]') return
      let parsed: any
      try { parsed = JSON.parse(data) } catch { throw new Error(`Invalid provider SSE data: ${data.slice(0, 500)}`) }
      if (parsed.error) throw new Error(`Provider stream error: ${parsed.error.message || JSON.stringify(parsed.error)}`)
      if (parsed.usage) {
        promptTokens = parsed.usage.prompt_tokens || promptTokens
        completionTokens = parsed.usage.completion_tokens || completionTokens
      }
      const choice = parsed.choices?.[0]
      if (!choice) return
      if (choice.finish_reason) finishReason = choice.finish_reason
      const delta = choice.delta
      if (delta?.content) {
        fullContent += delta.content
        request.onChunk?.(delta.content)
      }
      for (const tc of delta?.tool_calls || []) {
        const idx = tc.index ?? 0
        const key = tc.id || toolCallIndexes.get(idx) || `index:${idx}`
        if (tc.id) toolCallIndexes.set(idx, key)
        const current = toolCallsMap.get(key)
        if (!current) toolCallsMap.set(key, { id: tc.id || `call_${Date.now()}_${idx}`, name: tc.function?.name || '', args: tc.function?.arguments || '' })
        else {
          if (tc.id) current.id = tc.id
          if (tc.function?.name) current.name += tc.function.name
          if (tc.function?.arguments) current.args += tc.function.arguments
        }
      }
    }
    let finishReason = 'stop'
    let promptTokens = 0
    let completionTokens = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        if (buffer) processLine(buffer)
        buffer = ''
        break
      }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      for (const line of lines) processLine(line)
    }

    const assembledToolCalls = toolCallsMap.size > 0 ? Array.from(toolCallsMap.values()).map(tc => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.name,
        arguments: tc.args
      }
    })) : undefined

    return {
      id: `chatcmpl-${Date.now()}`,
      model: request.model || this.model,
      choices: [{
        message: {
          role: 'assistant',
          content: fullContent,
          tool_calls: assembledToolCalls
        },
        finish_reason: finishReason
      }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      }
    }
  }
}

export function createProvider(name: string, baseURL: string, apiKey: string, model: string): Provider {
  // For now, all providers use OpenAI-compatible interface
  // Can extend with Anthropic native, Google native, etc later
  return new OpenAICompatibleProvider(name, baseURL, apiKey, model)
}
