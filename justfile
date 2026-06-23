set positional-arguments

pi *args:
  @pi -e ./packages/goal/src/extension.ts -e ./packages/subagents/src/extension.ts -e ./packages/references/src/extension.ts -e ./packages/modes/src/extension.ts "$@"
