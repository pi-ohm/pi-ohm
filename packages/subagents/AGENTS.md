## About the @pi-ohm/subagents package

The pi-coding-agent does not ship with subagent support by default. This package will hold the base logic/implementation for subagents that can be extended into custom agents, but ships three default agents as outlined below.

Each of the below subagents should resemble tools with their respective names.

For the subagents package, we should ship with three subagents by default:

**the "librarian"**:

- a specialized codebase understanding agent that helps answer questions about large, complex codebases.
- works by reading from temporary local github checkouts
- works as the main agent's personal, multi-repository codebase expert, providing thorough analysis and comprehensive explanations across repositories

**the "finder"**:

- intelligently searches codebases for the main agent, used for complex, multi-step search tasks where the main agent needs to find code based on functionality or concepts rather than exact matches.
- any time the main agent wants to chain multiple grep calls, this subagent should be used.
- prefer faster models, like gpt-5.3-codex-spark, claude-haiku-4.5/claude-sonnet-4.6

**the "oracle"**:

- the oracle is an AI advisor, that can plan, review, and provide expert guidance
- the main agent should consult this subagent for code reviews, architecture feedback, finding difficult bugs in codepaths, planning complex implementations or refactors, answering complext technical questions that require deep technical reasoning, and providing an alternative point of view when the main agent is struggling to solve a problem
- prefer high thinking models, like gpt-5.2 with high/xhigh reasoning
- support for enabling the use of https://github.com/steipete/oracle (a subagent that is also named the "oracle")

An honorable mention, though in a separate package, `@pi-ohm/painter` should ship separately but reuse a similar format.

What makes this rather difficult is that it should be semi modular, such that different models can be plugged in for each agent, but ship with recommended "default" models.

Task orchestration UX baseline:

- use the `task` tool as the orchestration entrypoint
- use `@mariozechner/pi-tui` for live task status rendering
- running state should include: spinner, description, active tool-call count, elapsed time
- terminal state should replace spinner with success/failure indicator while keeping description/tool-count/elapsed summary
- preferred compact display is two lines:
  - line 1: `⠋ [finder] Auth flow scan`
  - line 2: `  Tools 3/3 · Elapsed 00:18`

Error handling baseline:

- use `better-result` for recoverable errors (`Result<T, E>`)
- model error categories with `TaggedError`
- avoid ad-hoc thrown recoverable exceptions and broad try/catch propagation

We want to mirror "anomalyco/opencode" implementation of subagents/agents

For instance, the full schema for an opencode style agent is:

```jsonc
{
  "name": "agent-name",
  "description": "agent-readable description",
  "mode": "subagent", // primary|subagent|all (default: subagent in this package)
  "primary": false, // when true, also expose as direct top-level tool (task-tool routing still supported)
  "model": "model-name",
  "reasoningEffort": "string - typically none|low|medium|high and xhigh for gpt-5 family OpenAI models",
  "prompt": "string - prompt to use for the agent, should also accept `{file:/path/to/prompt.txt|md}`",
}
```

And can be represented in a markdown file as:

```markdown
---
description: multi-repo codebase analysis helper
mode: subagent
primary: true
model: openai/gpt-5
reasoningEffort: high
---

You are the librarian. Build architecture maps and answer deep codebase questions.
```
