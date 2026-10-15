# FIX_REPORT.md

| Item | Status | Files | Verification |
|---|---|---|---|
| skill-engine | fixed | `vallenagent/src/skills.ts`, `vallenagent/tests/skill_selection.test.mjs` | Nested `metadata.hermes` tags/triggers supported; exact trigger outranks shared tag; matcher bounds long input. Skill selection tests pass. |
| context-recovery | fixed | `vallenagent/src/agent.ts`, `vallenagent/tests/c1_c6_regressions.test.mjs` | Estimate serialized request including tools; compact old history under token pressure; reject oversized active prompt without dropping it; normalize duplicate call IDs; assert call/result pairing. Regression tests pass. |
| provider-retry | fixed | `vallenagent/src/providers.ts`, `vallenagent/tests/provider_retry.test.mjs` | Retries share one request deadline; abort interrupts retry delay; emitted stream chunks are not replayed. Four deterministic provider tests pass. |
| parallel-tools | fixed | `vallenagent/src/agent.ts`, `vallenagent/src/tools.ts`, `vallenagent/src/builtin_tools.ts`, `vallenagent/tests/c1_c6_regressions.test.mjs` | Explicitly marked read-only tools run in consecutive batches capped at four; results retain model call order; approval-gated and mutating tools remain serial. Regression passes. |
| skill_manage batch schema | fixed | `vallenagent/src/builtin_tools.ts`, `vallenagent/tests/builtin_tools_plan_regressions.test.mjs` | Exposed nested atomic batch operation schema; rollback regression passes. |
| subagent dispatch message | fixed | `vallenagent/src/tools.ts` | Guard message matches tested contract; batch4 hardening test passes. |
| T1 | fixed | `vallenagent/src/gateway/router.ts`, `vallenagent/tests/gateway_dangerous_approval.test.mjs` | Sensitive paths and risky shell operations require approval; safe read-only project commands remain available. Regression tests pass. |
| T2 | fixed | `vallenagent/src/memory.ts`, `vallenagent/src/background_review.ts`, `vallenagent/tests/memory_security.test.mjs` | Reject secret-like, injected, control-character, and oversized memory; stored memory treated as data. Regression tests pass. |
| T3 | fixed | `vallenagent/src/memory.ts`, `vallenagent/tests/memory_match_ambiguity.test.mjs`, `vallenagent/tests/p2_config_memory_todo_regressions.test.mjs` | Deduplicate normalized additions; ambiguous replace/remove fail atomically. Regression tests pass. |
| T4 | fixed | `vallenagent/src/background_review.ts`, `vallenagent/src/agent.ts`, `vallenagent/tests/background_review_policy.test.mjs` | Bounded snapshots, controlled triggers, in-flight gate, fresh memory, and lightweight review agent. Regression tests pass. |
| T5 | fixed | `vallenagent/src/agent.ts`, `vallenagent/tests/history_compaction_summary.test.mjs` | Repeated compaction preserves prior summary and useful tool/user/assistant content. Regression test passes. |
| T6 | fixed | `vallenagent/src/agent.ts`, `vallenagent/tests/skill_preload_identity.test.mjs` | Skill preload attaches only to active user message, including duplicate text in history. Regression test passes. |
| T7 | fixed | `vallenagent/src/agent.ts`, `vallenagent/tests/skill_preload_persistence.test.mjs` | Active skill persists across follow-up turns and clears on session reset. Regression test passes. |
| T8 | fixed | `vallenagent/src/config.ts`, `vallenagent/tests/config_corrupt_backup.test.mjs` | Corrupt config quarantined; save aborts without replacing valid backup. Regression tests pass. |
| T9 | fixed | `vallenagent/src/agent.ts`, `vallenagent/tests/subagent_config_isolation.test.mjs` | Subagent config/cwd isolated from parent. Regression test passes. |
| T10 | fixed | `vallenagent/src/memory.ts`, `vallenagent/src/commands.ts`, `vallenagent/src/background_review.ts`, `vallenterminal/src/main/index.ts`, `vallenagent/tests/memory_project_scope.test.mjs`, `vallenagent/tests/memory_command.test.mjs` | Project memory scoped by cwd; user profile stays global; `/memory` controls and full-memory guidance added. Regression tests pass. |
| T11 | fixed | `vallenagent/src/builtin_tools.ts`, `vallenagent/tests/execute_code_process_group.test.mjs` | `execute_code` timeout/abort kills process group and cleans staged source. Regression tests pass. |
| T12 | skipped | — | Task specifies skip unless Windows target confirmed. Current target evidence is Linux; no Windows target confirmation. |
| T13 | fixed | `vallenagent/src/session.ts`, `vallenagent/src/agent.ts`, `vallenagent/tests/session_metadata_regressions.test.mjs`, `vallenagent/tests/interrupt_session_persistence.test.mjs` | Collision-resistant session IDs, compact history writes, lightweight listing metadata, and interrupt-path persistence. Regression tests pass. |
| T14 | fixed | `vallenagent/src/config.ts`, `vallenagent/src/agent.ts`, `vallenagent/src/tools.ts`, `vallenagent/src/logger.ts`, `vallenagent/src/types.ts`, `vallenagent/tests/agent_token_budget.test.mjs`, `vallenagent/tests/numeric_string_arguments.test.mjs`, `vallenagent/tests/logger_interactive.test.mjs` | Default 50,000-token per-turn ceiling caps provider output and stops further calls; pure numeric strings coerce before validation without mutating caller args; interactive logs go to private `logs/agent.log`. Regression tests pass. |
| Task continuity | fixed | `vallenagent/src/agent.ts`, `vallenagent/src/session.ts`, `vallenterminal/src/main/index.ts`, `vallenagent/tests/agent_task_continuity.test.mjs` | Action requests get a durable goal checklist; session resume restores it; each model request receives current state; premature finals trigger bounded continuation and explicit incomplete status; active-task chatter stays out of stream. Regression tests pass. |

Verification completed:
- `npm -w vallenagent run test` — 174/174 passed.
- `npm run typecheck` — agent and terminal passed.
- `npm run build` — agent and terminal passed.
- `git diff --check` — passed.
- Protected paths `BUGS.md`, `update.sh`, `.vallenatrix/skills/custom/` unchanged. Existing untracked `update.sh` preserved.

No commit created.

## Context retention / long-task fixes (2026-10-15)

| Item | Status | Files | Verification |
|---|---|---|---|
| Per-turn budget counted prompt tokens | fixed | `agent.ts`, `config.ts`, `types.ts` | Budget now counts output tokens only (default 400k); `max_tokens` per request capped (16384, `max_output_tokens`). Test: 12 iterations at 30k prompt tokens finish under a 50k budget. |
| Compaction too aggressive and lossy | fixed | `agent.ts` | Triggers at >70% window or >80 messages (was >20 messages). Keeps pinned original task + NEWEST lines (was oldest 15), records tool calls and `Files touched`, bounded size. |
| Long single turn never compacted | fixed | `agent.ts` | New `compactActiveTurn` summarizes older steps inside the active turn; progressively shrinks tail (12/6/2). |
| Old tool output pruned after 8 messages | fixed | `agent.ts` | Prune only above 50% window, tail 24 (6 above 85%), keeps 300-char head preview. |
| Task tracker leaked into real history | fixed | `agent.ts` | `pruneOldToolResults` always returns a copy; tracker is request-only. |
| False "incomplete" / discarded final answer | fixed | `agent.ts` | Auto-generated goal accepted after one nudge when tools already ran; incomplete report keeps the model's last text. |
| Small-window models overflowed | fixed | `agent.ts`, `types.ts` | `default_context_window`; skill preload and summary sized relative to window. |
| Temperature not configurable | fixed | `agent.ts`, `types.ts` | `temperature` config key forwarded when set. |

Tests: new `tests/context_retention.test.mjs` (12 tests); `agent_history_compaction.test.mjs` updated for the new trigger.
