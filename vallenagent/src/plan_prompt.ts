// /plan — build the plan-mode prompt: a saved markdown implementation plan, no execution.
// A first-class built-in with no engine and no model-tool footprint: every surface
// feeds buildPlanPrompt to the agent as a normal turn (matching Hermes agent/plan_prompt.py).

import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

export const PLAN_MODE_RULES = `For this turn, you are in PLAN MODE — planning only.

- Do not implement code.
- Do not edit project files except the plan markdown file itself.
- Do not run mutating terminal commands, commit, push, or perform external actions.
- You may inspect the repo or other context with read-only commands/tools when needed.
- Your deliverable is a markdown plan saved inside the active workspace under \`.vallenatrix/plans/YYYY-MM-DD_HHMMSS-<slug>.md\` (create the directory if needed). If the runtime provides a specific target path, use that exact path instead.`

export const PLAN_CRAFT = `Write the plan for an implementer with zero context for the codebase and questionable taste. A good plan makes implementation obvious — if someone has to guess, the plan is incomplete.

Structure (include the sections that are relevant):
- Goal — one sentence.
- Current context / assumptions.
- Architecture / proposed approach — 2-3 sentences.
- Step-by-step tasks. Each task is bite-sized (2-5 minutes of focused work), names exact file paths (\`src/models/user.py\`, not "the model file"), includes complete copy-pasteable code where code is needed, and exact commands with expected output for verification.
- Tests / validation — for code tasks, follow the TDD cycle per task: write the failing test, run it to verify failure, implement minimally, run to verify pass, commit.
- Risks, tradeoffs, and open questions.

Principles: DRY, YAGNI, TDD, frequent commits. Avoid vague tasks ("add authentication"), incomplete code ("add validation here"), and unverifiable steps ("test it works" — instead: the exact command and its expected output).

Interaction style:
- If the request is clear enough, write the plan directly.
- If it is genuinely underspecified, ask a brief clarifying question instead of guessing.
- After saving the plan, reply briefly with what you planned and the saved path, and offer to execute it (e.g. via subagent-driven development) — but do not start executing in this turn.`

export function buildPlanPrompt(task: string = ''): string {
  const cleaned = (task || '').trim()
  const taskBlock = cleaned
    ? `Task to plan:\n${cleaned}\n`
    : `No explicit task was given with /plan — infer the task from the current conversation context (the thing we have been discussing or working toward). If the conversation does not imply a task, ask a brief clarifying question.\n`

  return `[/plan — plan mode]\n\n${PLAN_MODE_RULES}\n\n${taskBlock}\n${PLAN_CRAFT}`
}

export interface PlanFile {
  filename: string
  path: string
  createdAt: Date
  size: number
}

export function listPlans(workspaceDir?: string): PlanFile[] {
  const cwd = workspaceDir || process.cwd()
  const plansDir = join(cwd, '.vallenatrix', 'plans')
  if (!existsSync(plansDir)) return []

  try {
    const files = readdirSync(plansDir).filter(f => f.endsWith('.md'))
    return files
      .map(filename => {
        const fullPath = join(plansDir, filename)
        const stat = statSync(fullPath)
        return {
          filename,
          path: fullPath,
          createdAt: stat.mtime,
          size: stat.size
        }
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  } catch {
    return []
  }
}
