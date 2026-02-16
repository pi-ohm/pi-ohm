# Changesets

This repo uses [Changesets](https://github.com/changesets/changesets) for versioning and changelogs.

## Common commands

```bash
# create a release note + bump intent file

yarn changeset

# apply version bumps + changelogs from pending changesets

yarn version-packages

# publish packages to npm (usually done in CI)

yarn release
```

## Workflow

1. On feature PRs, add a changeset (`yarn changeset`) for any package that should release.
2. On `main`, release workflow opens/updates a **Version Packages** PR.
3. Merge that PR to apply version bumps and changelog updates.
4. Release workflow publishes to npm and creates GitHub tags/releases.
