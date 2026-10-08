// Background self-improvement review - spawns post-turn analysis agent

import type { Message } from './providers'

export interface ReviewCallbacks {
  onReviewComplete?: (summary: string) => void
  onReviewError?: (error: string) => void
}

const REVIEW_SYSTEM_PROMPT = `You are a background review agent. Your sole job: analyze the conversation and decide if any skill or memory needs updating.

Rules:
- Read skill with skill_view BEFORE patching (required)
- Patch when: skill wrong/missing steps/outdated
- Add subsection, pitfall, or broaden existing skill coverage
- Format: skill_manage(operations=[{action:'patch', name:'...', old_string:'...', new_string:'...'}])
- Memory updates: use memory(action='add'/'replace') for user facts/environment
- If nothing needs updating, respond "No updates needed"

Available tools: skill_view, skills_list, skill_manage, memory, read_file, search_files

Be surgical. Only update when conversation revealed: wrong info in skill, missing critical step, new pitfall discovered, or user preference stated.`

const REVIEW_USER_PROMPT = `After reviewing this conversation, should any skill or memory be saved/updated?

Analyze this conversation:
1. Skills that were wrong/incomplete
2. New pitfalls discovered
3. User preferences stated
4. Environment facts learned

If yes, update them. If no, respond "No updates needed".`

export async function spawnBackgroundReview(
  conversationSnapshot: Message[],
  agentFactory: (prompt: string, systemPrompt: string, toolWhitelist: string[]) => Promise<string>,
  callbacks?: ReviewCallbacks
): Promise<void> {
  // Fire and forget - don't block main thread
  setImmediate(async () => {
    try {
      const toolWhitelist = ['skill_view', 'skills_list', 'skill_manage', 'memory', 'read_file', 'search_files']
      
      const summary = await agentFactory(
        `${REVIEW_USER_PROMPT}\n\nConversation snapshot (JSON):\n${JSON.stringify(conversationSnapshot)}`,
        REVIEW_SYSTEM_PROMPT,
        toolWhitelist
      )
      
      // Check if agent actually made changes
      const madeChanges = !summary.toLowerCase().includes('no updates needed')
      
      if (madeChanges) {
        callbacks?.onReviewComplete?.(summary)
      }
    } catch (err: any) {
      callbacks?.onReviewError?.(err.message || String(err))
    }
  })
}
