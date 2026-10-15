export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
}

export class TodoStore {
  private items: TodoItem[] = []
  private revision: number = 0

  constructor(initialItems: TodoItem[] = []) {
    this.items = [...initialItems]
  }

  write(todos: Array<Partial<TodoItem> & { id: string }>, merge: boolean = false): TodoItem[] {
    if (!merge) {
      const ids = new Set<string>()
      this.items = todos.map(t => {
        const id = String(t.id || '').trim()
        if (!id) throw new Error('Todo id cannot be empty')
        if (ids.has(id)) throw new Error(`Duplicate todo id: ${id}`)
        ids.add(id)
        
        return {
          id,
          content: String(t.content || '').trim(),
          status: (['pending', 'in_progress', 'completed', 'cancelled'].includes(t.status || '') ? t.status : 'pending') as TodoItem['status']
        }
      })
    } else {
      for (const t of todos) {
        const id = String(t.id || '').trim()
        if (!id) throw new Error('Todo id cannot be empty')
        
        const existing = this.items.find(i => i.id === id)
        if (existing) {
          if (t.content) existing.content = String(t.content).trim()
          if (t.status && ['pending', 'in_progress', 'completed', 'cancelled'].includes(t.status)) {
            existing.status = t.status as TodoItem['status']
          }
        } else {
          this.items.push({
            id,
            content: String(t.content || '').trim(),
            status: (['pending', 'in_progress', 'completed', 'cancelled'].includes(t.status || '') ? t.status : 'pending') as TodoItem['status']
          })
        }
      }
    }
    this.revision++
    return this.read()
  }

  read(): TodoItem[] {
    return this.items.map(i => ({ ...i }))
  }

  formatForInjection(): string | null {
    if (this.items.length === 0) return null
    const lines = ['[Active Task List]']
    for (const item of this.items) {
      let mark = '[ ]'
      if (item.status === 'completed') mark = '[x]'
      else if (item.status === 'in_progress') mark = '[>]'
      else if (item.status === 'cancelled') mark = '[~]'
      lines.push(`${mark} ${item.id}. ${item.content} (${item.status})`)
    }
    return lines.join('\n')
  }
}
