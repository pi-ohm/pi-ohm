# @pi-ohm/subagents

Install only subagent support for Pi (task-routed + primary-tool profiles).

```bash
pi install npm:@pi-ohm/subagents
```

Scaffolded subagents:

- `librarian` — multi-repo code understanding (default: primary-tool profile)
- `oracle` — reasoning-heavy advisor/reviewer
- `finder` — intelligent behavior-based search
- `task` — isolated parallel execution worker
- `painter` — explicit-request image generation/editing helper

Profiles can be marked with `primary: true` in config/catalog to indicate direct
invocation as a top-level tool entrypoint instead of task-tool-only invocation.

Primary profiles are registered as direct tools automatically. Tool names are derived
from profile IDs with deterministic collision handling.

`primary: true` is additive:

- profile gets a direct top-level tool
- profile stays available in `task` subagent roster (`subagent_type`)
- direct-tool execution and task-routed execution share the same runtime/result envelope

The orchestration tool name is **`task`**. Async orchestration lifecycle
operations (`start/status/wait/send/cancel`) are exposed through this tool.
Subagent starts are synchronous/blocking. `async:true` start requests are rejected.

## Task tool (current)

Current behavior:

- supports `op: "start"` for a single task payload (sync)
- supports batched `op: "start"` payloads via `tasks[]` with optional `parallel:true`
- supports lifecycle operations: `status`, `wait`, `send`, `cancel`
- input normalization: `status`/`wait` accept `id` or `ids`; `op:"result"` is normalized to `status`
- non-debug result text renders Amp-style inline message trees (prompt -> tool calls -> result)
- running updates stream inline tool rows in-place from SDK events
- returns `task_id`, status, and deterministic task details
- includes explicit wait/cancel ergonomics fields:
  - `wait_status` (`completed|timeout|aborted`)
  - `done` (boolean completion flag for `wait`)
  - `cancel_applied`
  - `prior_status`
- includes batch acceptance accounting for `start` with `tasks[]`:
  - `total_count`
  - `accepted_count`
  - `rejected_count`
  - `batch_status` (`accepted|partial|completed|rejected`)
- includes structured output metadata in details/items:
  - `output_available`
  - `output_truncated`
  - `output_total_chars`
  - `output_returned_chars`
- includes structured SDK-derived tool transcript rows in details/items when available:
  - `tool_rows` (deterministic per-tool lifecycle rows)
  - `event_count` (captured structured event count)
  - `assistant_text` (event-derived assistant transcript tail)
- includes machine marker on every tool details payload:
  - `contract_version: "task.v1"`
- includes observability fields on details/items:
  - `provider`
  - `model`
  - `runtime`
  - `route`
- collection lifecycle ops (`status`/`wait`) aggregate observability from task items
  (so top-level `runtime`/`route` align with per-item metadata when present)
- persists task registry snapshots to disk for resume/reload behavior
- enforces terminal-task retention expiry with explicit `task_expired` lookup errors
- validates all payloads with TypeBox boundary schema + typed Result errors

## Subagent backend behavior

Runtime backend is selected from `subagentBackend` config:

- `interactive-sdk` (default): executes subagent prompts through in-process Pi SDK
  sessions with in-memory session/settings managers
- `interactive-shell` (fallback): executes a real nested `pi` run for subagent prompts
  using built-in tools (`read,bash,edit,write,grep,find,ls`)
- `none`: uses deterministic scaffold backend (echo-style debug output)
- `custom-plugin`: currently returns `unsupported_subagent_backend`

Per-subagent model override is supported via `ohm.json`:

```jsonc
{
  "subagents": {
    "finder": { "model": "openai/gpt-4o" },
    "oracle": { "model": "anthropic/claude-sonnet-4-5" },
    "librarian": { "model": "openai/gpt-5:high" },
  },
}
```

- format is required: `<provider>/<model>`
- optional thinking suffix: `<provider>/<model>:<thinking>`
- valid thinking values: `off|minimal|low|medium|high|xhigh`
- provider is normalized to lowercase
- SDK backend validates against Pi model registry (built-ins + custom `models.json`)
- interactive-shell backend forwards the same `--model` pattern to nested `pi`

Optional safety fallback:

- set `OHM_SUBAGENTS_SDK_FALLBACK_TO_CLI=true` to fallback from `interactive-sdk` to
  `interactive-shell` when SDK bootstrap/execution fails (`task_backend_execution_failed`)

If output appears like prompt regurgitation, verify `subagentBackend` is not set to `none`.

Nested interactive-shell outputs are sanitized to strip runtime metadata lines (`backend:`,
`provider:`, `model:`) before surfacing task output.

For unknown tasks/expired tasks, error categorization is explicit: `error_category: "not_found"`.

## Operator cookbook

### 1) Execution mode policy

| scenario                                     | recommended mode              | why                                                     |
| -------------------------------------------- | ----------------------------- | ------------------------------------------------------- |
| quick lookup, single task, result needed now | `start` (sync blocking)       | simplest UX; one call, one terminal result              |
| fan-out independent tasks                    | `start tasks[] parallel:true` | deterministic ordered aggregation + bounded concurrency |
| follow-up on an existing active task         | `send`                        | preserves task history + follow-up prompts              |

`async:true` start requests are rejected (`task_async_disabled`).

### 2) Backend tradeoff matrix

| backend                        | strengths                                                                    | tradeoffs                                        | when to pick                   |
| ------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------ |
| `interactive-sdk` (default)    | structured tool/assistant events, event-derived rows, better inline fidelity | newer path                                       | default                        |
| `interactive-shell` (fallback) | mature nested CLI behavior; straightforward rollback                         | text-capture based transcript fidelity           | explicit rollback / fallback   |
| `none`                         | deterministic scaffold output                                                | no real execution                                | testing/demo/debug wiring only |
| `custom-plugin`                | reserved hook                                                                | not implemented (`unsupported_subagent_backend`) | none currently                 |

Fallback policy:

- enable `OHM_SUBAGENTS_SDK_FALLBACK_TO_CLI=true` to downgrade only recoverable SDK bootstrap failures (`task_backend_execution_failed`) from SDK -> CLI path.

### 3) Recommended smoke matrix

```bash
# default backend visibility
printf '/ohm-subagents\n' | pi -e ./packages/subagents/extension.ts

# explicit sdk backend visibility
mkdir -p /tmp/pi-ohm-sdk-smoke
cat >/tmp/pi-ohm-sdk-smoke/ohm.json <<'EOF'
{ "subagentBackend": "interactive-sdk" }
EOF
printf '/ohm-subagents\n' | PI_CONFIG_DIR=/tmp/pi-ohm-sdk-smoke pi -e ./packages/subagents/extension.ts
```

Task lifecycle smoke checklist:

1. sync single `start`
2. async guard (`start async:true` returns `task_async_disabled`)
3. batch partial acceptance (`tasks[]` mixed validity)
4. timeout path (`wait timeout_ms`)
5. follow-up `send` on running task

### 4) Troubleshooting quick map

| symptom                                 | likely cause                                                   | check/fix                                                                      |
| --------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| output looks scaffolded/echoed          | backend is `none`                                              | set `subagentBackend` to `interactive-shell` or `interactive-sdk`              |
| sdk selected but execution drops to cli | fallback env enabled and sdk hit recoverable bootstrap failure | inspect `OHM_SUBAGENTS_SDK_FALLBACK_TO_CLI`; disable to keep hard sdk failures |
| `task_wait_timeout`                     | task still non-terminal at timeout                             | increase `timeout_ms`, poll with `status`, or reduce batch size                |
| `task_wait_aborted`                     | caller signal cancelled wait                                   | retry wait with active signal                                                  |
| `task_expired` on old IDs               | retention/capacity eviction                                    | increase retention/cap env knobs; treat task IDs as ephemeral                  |
| too many inline progress updates        | high-frequency non-terminal emissions                          | increase `OHM_SUBAGENTS_ONUPDATE_THROTTLE_MS`                                  |

### 5) Guardrail env knobs

- `OHM_SUBAGENTS_TASK_RETENTION_MS` — terminal task retention window
- `OHM_SUBAGENTS_TASK_MAX_EVENTS` — per-task structured event cap
- `OHM_SUBAGENTS_TASK_MAX_ENTRIES` — in-memory task registry cap
- `OHM_SUBAGENTS_TASK_MAX_EXPIRED_ENTRIES` — expired-task reason cache cap
- `OHM_SUBAGENTS_ONUPDATE_THROTTLE_MS` — non-terminal onUpdate emission throttle
- `OHM_SUBAGENTS_OUTPUT_MAX_CHARS` — terminal output payload cap

### Output truncation policy

Task output returned in tool payloads is capped to prevent oversized context injection.

- env override: `OHM_SUBAGENTS_OUTPUT_MAX_CHARS`
- default cap: `8000` chars
- when truncation occurs, payloads include:
  - `output_truncated: true`
  - `output_total_chars`
  - `output_returned_chars`

Example payload:

```jsonc
{
  "op": "start",
  "subagent_type": "finder",
  "description": "Auth flow scan",
  "prompt": "Trace token validation + refresh paths",
}
```

Batch execution notes:

- aggregate item order is deterministic (input order)
- bounded parallelism is enforced by `subagents.taskMaxConcurrency` (default `3`)
- task failures are isolated; one failed batch item does not abort siblings

## Task permission policy

Task orchestration enforces policy decisions from runtime config:

- `allow` — task execution proceeds
- `deny` — execution is blocked with `task_permission_denied`

Config shape:

```jsonc
{
  "subagents": {
    "permissions": {
      "default": "allow",
      "subagents": {
        "finder": "deny",
      },
      "allowInternalRouting": false,
    },
  },
}
```

Additional hardening behaviors:

- internal profiles (`internal:true`) are hidden from task roster exposure unless
  `allowInternalRouting` is enabled
- wait timeout/abort are explicit (`task_wait_timeout`, `task_wait_aborted`)
- tool error payloads include stable `error_category`

Persistence details:

- default snapshot path: `${PI_CONFIG_DIR|PI_CODING_AGENT_DIR|PI_AGENT_DIR|~/.pi/agent}/ohm.subagents.tasks.json`
- retention window is configurable via `OHM_SUBAGENTS_TASK_RETENTION_MS` (positive integer ms)
- per-task structured event timeline cap is configurable via `OHM_SUBAGENTS_TASK_MAX_EVENTS`
  (default `120`)
- in-memory task registry capacity is configurable via `OHM_SUBAGENTS_TASK_MAX_ENTRIES`
  (default `200`); oldest terminal tasks are evicted first once cap is exceeded
- expired-task reason cache is configurable via `OHM_SUBAGENTS_TASK_MAX_EXPIRED_ENTRIES`
  (default `500`)
- corrupt snapshot files are auto-recovered to `*.corrupt-<epoch>` and runtime falls back to empty state
- inline `onUpdate` emission is throttled via `OHM_SUBAGENTS_ONUPDATE_THROTTLE_MS`
  (default `120ms`) with duplicate-frame suppression to avoid async wait/update spam

## Migration notes

Behavior has moved from scaffold-only single start calls to a lifecycle runtime,
with real backend execution as the default:

- orchestration now supports `start/status/wait/send/cancel`
- batched `start` supports deterministic ordering and bounded concurrency
- primary tools and task-routed calls share one execution/runtime contract
- policy-denied calls now fail deterministically instead of silently proceeding

Existing slash commands remain unchanged:

- `/ohm-subagents`
- `/ohm-subagent <id>`

## Invocation mode behavior

`task-routed` and `primary-tool` invocation paths share one runtime/result envelope.

Current shared fields:

- `contract_version`
- `status`
- `subagent_type`
- `description`
- `backend`
- `provider`
- `model`
- `runtime`
- `route`
- `output_available`
- `output` (subject to truncation policy)

Invocation mode differences are intentional and explicit via `invocation`:

- `task-routed` for non-primary profiles
- `primary-tool` for direct primary profile calls

## Live TUI feedback

`@pi-ohm/subagents` uses shared component `@pi-ohm/tui` (`SubagentTaskTreeComponent`) for task runtime visuals.
Live bottom widget mode now defaults to `off`; inline tool-result updates are the primary UX.

Baseline running-task display includes:

- spinner
- prompt line from task start payload (main-agent instruction)
- best-effort parsed tool-call rows
- terminal/final result row

Runtime UI surfaces are synchronized from one task snapshot model:

- footer status (`setStatus`) with running/active counters
- widget task tree (`setWidget`) using Amp-style tree component
- headless fallback `onUpdate` text with equivalent description/tool-count/elapsed info

Example running block:

```bash
  ⠋ Finder · Auth flow scan
    ├── Trace auth validation
    ├── ✓ Read packages/subagents/src
    ├── ✓ Grep auth|token in packages/subagents/src
    ╰── Working...
```

Terminal examples:

```bash
  ✓ Finder · Auth flow scan
    ├── Trace auth validation
    ├── ✓ Read packages/subagents/src
    ╰── Auth validation path uses task permission policy + runtime store transitions.

  ✕ Finder · Auth flow scan
    ├── Trace auth validation
    ╰── Task failed: backend timeout while reading repository files.
```

## Error handling

`@pi-ohm/subagents` uses `better-result` for recoverable errors:

- runtime and orchestration paths should return `Result<T, E>`
- typed error categories should use `TaggedError`
- avoid broad try/catch error propagation for recoverable failures

Commands:

- `/ohm-subagents`
- `/ohm-subagent <id>`

## Primary tool input schemas

For profiles marked `primary:true`, direct tool input schema is subagent-specific:

- `librarian`
  - required: `query`
  - optional: `context`, `description`
- `oracle`
  - required: `task`
  - optional: `context`, `files[]`, `description`
- `finder`
  - required: `query`
  - optional: `description`

Normalization behavior:

- `context` is forwarded in a dedicated prompt section (`Context:`)
- oracle `files[]` is forwarded in a dedicated prompt block (`Files:` + bullet paths)
- `async:true` inputs are rejected by task lifecycle policy (`task_async_disabled`)
- task lifecycle/result payload remains the same shape after primary normalization
