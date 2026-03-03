---
name: tuistory
description: |
  Playwright for terminal apps. Like tmux but designed for agents — virtual terminals you can type into, press keys, wait for text, take snapshots, and screenshot as images. tuistory has **2 modes**:

  - **CLI** (`tuistory` command) — shell-based. Launch sessions, type, press keys, snapshot, screenshot.
    Runs a background daemon that persists sessions across commands. Install globally or use `npx`/`bunx`.
    **You MUST run `tuistory --help` before using the CLI** to see the latest commands and options.
  - **JS/TS API** (`import { launchTerminal } from 'tuistory'`) — programmatic. Use in vitest/bun:test to write Playwright-style tests for CLIs and TUIs with inline snapshots.

  Use tuistory when you need to:
  - Write e2e tests for CLI/TUI apps (vitest, bun:test) with inline snapshots
  - Automate terminal interactions (launch a REPL, debugger, or TUI and drive it)
  - Screenshot terminal as images to send to users (Discord bots, agent UIs like kimaki/openclaw)
  - Reproduce bugs in interactive CLIs by scripting the exact steps
  - Explore TUI apps progressively with observe-act-observe loops
---

# tuistory

Playwright for terminal user interfaces. Write end-to-end tests for CLI and TUI applications.

tuistory has **2 modes**:

1. **CLI** — the `tuistory` shell command. Launch terminal sessions, type text, press keys, take text snapshots or image screenshots. Sessions run in a background daemon and persist across commands.
2. **JS/TS API** — `import { launchTerminal } from 'tuistory'`. Use programmatically in test files (vitest, bun:test) to write Playwright-style tests with inline snapshots.

## Tips

- **Always set a timeout** on `waitForText` for async operations
- **Use `trimEnd: true`** in `session.text()` to avoid trailing whitespace in snapshots
- **Set `waitForData: false`** for interactive commands that don't produce output immediately (like `cat`)
- **Use regex** in `waitForText` for dynamic content: `await session.waitForText(/version \d+/)`
- **Close sessions** in test teardown to avoid leaked processes
- **Use `--cols` and `--rows`** to control terminal size — affects TUI layout

## References **important**

| Reference               | Path                | Description                                           |
| ----------------------- | ------------------- | ----------------------------------------------------- |
| CLI Documentation       | ./references/cli.md | test TUIs/CLIs with the tuistory CLI                  |
| JS/TS API Documentation | ./references/sdk.md | programmatically test TUIs/CLIs with the tuistory sdk |
