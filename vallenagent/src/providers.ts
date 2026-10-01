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
        stream: false
      })
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Provider API error: ${response.status} ${error}`)
    }

    return (await response.json()) as CompletionResponse
  }
}

export function createProvider(name: string, baseURL: string, apiKey: string, model: string): Provider {
  // For now, all providers use OpenAI-compatible interface
  // Can extend with Anthropic native, Google native, etc later
  return new OpenAICompatibleProvider(name, baseURL, apiKey, model)
}
