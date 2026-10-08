// Tool registry system mirroring Hermes architecture

export interface ToolParameter {
  type: string
  description?: string
  enum?: string[]
  items?: ToolParameter
  properties?: Record<string, ToolParameter>
  required?: string[]
  default?: any
}

export interface ToolSchema {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, ToolParameter>
    required?: string[]
  }
}

export type ToolHandler = (args: Record<string, any>, context: ToolContext, signal?: AbortSignal) => Promise<string>

export interface ToolContext {
  sessionId?: string
  taskId?: string
  workingDir?: string
  isSubagent?: boolean
  stores?: {
    memory?: any
    todo?: any
    skillLoader?: any
  }
}

export interface ToolRegistration {
  name: string
  schema: ToolSchema
  handler: ToolHandler
  toolset: string
  checkFn?: () => boolean
}

class ToolRegistry {
  private tools: Map<string, ToolRegistration> = new Map()
  private whitelist: string[] | null = null

  register(tool: ToolRegistration): void {
    if (this.tools.has(tool.name)) {
      console.warn(`[Tools] Overwriting existing tool: ${tool.name}`)
    }
    this.tools.set(tool.name, tool)
  }

  get(name: string): ToolRegistration | undefined {
    return this.tools.get(name)
  }

  list(): ToolRegistration[] {
    return Array.from(this.tools.values())
  }

  listByToolset(toolset: string): ToolRegistration[] {
    return this.list().filter(t => t.toolset === toolset)
  }

  filterTools(whitelist: string[]): void {
    this.whitelist = whitelist
  }

  clearFilter(): void {
    this.whitelist = null
  }

  getSchemas(enabledToolsets: string[] = [], whitelist?: string[]): ToolSchema[] {
    let tools = this.list()
    const allowedTools = whitelist ?? this.whitelist
    if (allowedTools) tools = tools.filter(t => allowedTools.includes(t.name))
    
    if (enabledToolsets.length > 0) {
      tools = tools.filter(t => enabledToolsets.includes(t.toolset))
    }
    
    // Filter by availability check
    tools = tools.filter(t => {
      if (!t.checkFn) return true
      try {
        return t.checkFn()
      } catch {
        return false
      }
    })
    
    return tools.map(t => t.schema)
  }

  getOpenAISchemas(enabledToolsets: string[] = [], whitelist?: string[]): Array<{ type: 'function'; function: ToolSchema }> {
    return this.getSchemas(enabledToolsets, whitelist).map(s => ({
      type: 'function',
      function: s
    }))
  }

  async execute(name: string, args: Record<string, any>, context: ToolContext = {}, whitelist?: string[], signal?: AbortSignal): Promise<string> {
    if (whitelist && !whitelist.includes(name)) return JSON.stringify({ error: `Tool not allowed: ${name}` })
    const tool = this.tools.get(name)
    
    if (!tool) {
      return JSON.stringify({ error: `Tool not found: ${name}` })
    }
    
    try {
      return await tool.handler(args, context, signal)
    } catch (err: any) {
      console.error(`[Tools] Error executing ${name}:`, err)
      return JSON.stringify({ error: err.message || 'Tool execution failed' })
    }
  }
}

export const registry = new ToolRegistry()
