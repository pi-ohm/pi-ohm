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

## Task tool (current)

Current behavior:

- supports `op: "start"` for a single task payload (sync + `async:true`)
- supports batched `op: "start"` payloads via `tasks[]` with optional `parallel:true`
- supports lifecycle operations: `status`, `wait`, `send`, `cancel`
- compatibility aliases: `status`/`wait` accept `id` or `ids`; `op:"result"` is normalized to `status`
- result text now always labels concise summary explicitly (`summary:`) and keeps canonical result in `output`
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
- includes stable machine contract marker on every tool details payload:
  - `contract_version: "task.v1"`
- includes stable observability fields on details/items:
  - `provider`
  - `model`
  - `runtime`
  - `route`
- persists task registry snapshots to disk for resume/reload behavior
- enforces terminal-task retention expiry with explicit `task_expired` lookup errors
- validates all payloads with TypeBox boundary schema + typed Result errors

## Subagent backend behavior

Runtime backend is selected from `subagentBackend` config:

- `interactive-shell` (default): executes a real nested `pi` run for subagent prompts
  using built-in tools (`read,bash,edit,write,grep,find,ls`)
- `none`: uses deterministic scaffold backend (echo-style debug output)
- `custom-plugin`: currently returns `unsupported_subagent_backend`

If output appears like prompt regurgitation, verify `subagentBackend` is not set to `none`.

Nested interactive-shell outputs are sanitized to strip runtime metadata lines (`backend:`,
`provider:`, `model:`) before surfacing task output.

For unknown tasks/expired tasks, error categorization is explicit: `error_category: "not_found"`.

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
- async mixed-validity batch starts no longer collapse to top-level failure when tasks were accepted;
  use acceptance counters + `batch_status` to decide polling behavior

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
- corrupt snapshot files are auto-recovered to `*.corrupt-<epoch>` and runtime falls back to empty state

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

## Invocation mode parity

`task-routed` and `primary-tool` invocation paths share one runtime/result envelope.

Expected parity fields:

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

`@pi-ohm/subagents` uses `@mariozechner/pi-tui` for task runtime visuals.

Baseline running-task display includes:

- spinner
- task description (from original `task` start payload)
- in-flight tool call count
- elapsed time (`mm:ss`)

Runtime UI surfaces are synchronized from one task snapshot model:

- footer status (`setStatus`) with running/active counters
- widget task list (`setWidget`) using two-line per-task renderer
- headless fallback `onUpdate` text with equivalent description/tool-count/elapsed info

Example running block:

```bash
⠋ [finder] Auth flow scan
  Tools 3/3 · Elapsed 00:18
```

Terminal examples:

```bash
✓ [finder] Auth flow scan
  Tools 5/5 · Elapsed 00:42

✕ [finder] Auth flow scan
  Tools 2/3 · Elapsed 00:11
```

## Error handling

`@pi-ohm/subagents` uses `better-result` for recoverable errors:

- runtime and orchestration paths should return `Result<T, E>`
- typed error categories should use `TaggedError`
- avoid broad try/catch error propagation for recoverable failures

Commands:

- `/ohm-subagents`
- `/ohm-subagent <id>`
