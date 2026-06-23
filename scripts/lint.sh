#!/bin/sh
set -eu

mode="${1:-all}"

run_oxlint() {
  env -u npm_lifecycle_event pnpm --reporter append-only exec vp lint . \
    --tsconfig tsconfig.json \
    --type-aware \
    --ignore-pattern "**/dist/**" \
    --ignore-pattern "**/src_legacy/**" \
    --threads=1 "$@"
}

run_ast_grep() {
  env -u npm_lifecycle_event pnpm --reporter append-only exec ast-grep \
    --config sgconfig.yml scan . \
    --globs '!**/dist/**' \
    --globs '!**/src_legacy/**' \
    --globs '!docs/.output/**' \
    --report-style short
}

if [ "$mode" = "ox" ]; then
  run_oxlint
  exit 0
fi

if [ "$mode" = "ast" ]; then
  run_ast_grep
  exit 0
fi

if [ "$mode" = "fix" ]; then
  run_oxlint --fix
  exit 0
fi

run_oxlint
run_ast_grep
