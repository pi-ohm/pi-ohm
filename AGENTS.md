# AGENTS.md

## General guidelines

- Be concise, sacrificing grammar for brevity.
- Write high-coverage tests. You don't need to write a million tests. Always begin with failing tests or tests that reproduce a bug.
- Lint and check with `yarn lint` and `yarn typecheck`

## Repo shape

This is a Yarn-workspace monorepo for publishable `@pi-ohm/*` and `pi-ohm` packages.

## Writing code in this repo

you should uphold these standards whenever you write code in this repo:

```
**Why pi-ohm?**

1. opinionated: you're always using the good parts of pi-ohm. If we don't use and love a feature, we kill it.
2. on the frontier: pi-ohm goes where the models take it. no backcompat, no legacy features.
```

## Rules

1. New work goes in `packages/*` (feature package per capability).
2. Keep command namespace under `ohm-*`.
3. Register settings via `@juanibiapina/pi-extension-settings`.
4. Support config in:
   - `.pi/ohm.json`
   - `${PI_CONFIG_DIR|PI_CODING_AGENT_DIR|PI_AGENT_DIR|~/.pi/agent}/ohm.json`
   - `${PI_CONFIG_DIR|PI_CODING_AGENT_DIR|PI_AGENT_DIR|~/.pi/agent}/ohm.providers.json`
5. Use Yarn commands (`yarn install`, `yarn test`) instead of npm.
6. Branch model: `dev` is integration + release-prep; `prod` is promotion/stable publish branch.
7. Versioning/changelog automation is release-please (not changesets).
8. Use scoped conventional commits for release automation (`feat(subagents):`, `fix(root,modes):`, `feat(config)!:`, etc.).
9. Keep publishable packages in lockstep versioning (`@pi-ohm/*` and `pi-ohm` share the same release version).

## Packaging goal

Each feature package should be installable by itself through npm, which is the Pi's means of distribution:

amp features:

- `@pi-ohm/handoff`
- `@pi-ohm/subagents`
- `@pi-ohm/session-search`
- `@pi-ohm/painter`
- `@pi-ohm/modes`

helpers:

- `@pi-ohm/tui`
- `@pi-ohm/config`
- `@pi-ohm/core`

Full bundle package:

- `pi-ohm`

## Testing Framework

1. **You should write failing tests before implementing features.**
2. If you encounter a bug, you should write a test for that bug to hash out why it's failing, and then fix the bug.
3. Tests should live in test folders alongside the files that you're testing (e.g., `packages/tui/src/extension.ts` has tests in `packages/tui/src/tests/extension.test.ts`).

## TODO.md & ARCH.md

These two files serve as a strong human-agent plane for planning and implementing features.

Generally, you want to treat them as if you were working in an agile team.

<important>
You want to break tasks in TODO.md down into verifiable, demoable "sprints". Some questions to consider: how would you do it (**timeline and legacy APIs DO NOT matter**) - every task/ticket should be an atomic, commitable piece of work that is testable. Every sprint should be a demoable piece of software that can be run, tested, and build on top of previous work/sprints. Be exhaustive. Be clear. Be technical - but technical in requirements - not implementation details per se. It should read like it's gone through a single back and forth with a technical product manager. Always focus on small atomic tasks that compose a clear goal for each sprint.

**IMPORTANT:** we have no external consumers, so code should not be written in a legacy-first manner. Nor should we ever care about backwards compatibility, backporting legacy APIs, or generally anything that could potentially prohibit us from (a) shipping fast and (b) breaking things.
</important>

## Error Handling

- All errors should be handled via `better-result` package: https://github.com/dmmulroy/better-result. You should use the better-result skill for more information.

## Style Guide

- Keep things in one function unless composable or reusable
- Avoid unnecessary destructuring. Instead of `const { a, b } = obj`, use `obj.a` and `obj.b` to preserve context
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Prefer single word variable names where possible

# Avoid let statements

We don't like `let` statements, especially combined with if/else statements.
Prefer `const`.

Good:

```ts
const foo = condition ? 1 : 2;
```

Bad:

```ts
let foo;

if (condition) foo = 1;
else foo = 2;
```

# Avoid else statements

Prefer early returns or using an `iife` to avoid else statements.

Good:

```ts
function foo() {
  if (condition) return 1;
  return 2;
}
```

Bad:

```ts
function foo() {
  if (condition) return 1;
  else return 2;
}
```

# Prefer single word naming

Try your best to find a single word name for your variables, functions, etc.
Only use multiple words if you cannot.

Good:

```ts
const foo = 1;
const bar = 2;
const baz = 3;
```

Bad:

```ts
const fooBar = 1;
const barBaz = 2;
const bazFoo = 3;
```
