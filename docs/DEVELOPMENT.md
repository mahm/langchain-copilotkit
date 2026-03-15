# Development Guide

## Quality Checks

Both packages have `bun run check` scripts enforced by a husky pre-commit hook.

| Package | Command | What it runs |
|---------|---------|-------------|
| `packages/langchain-copilotkit` | `bun run check` | biome check + tsc + knip + bun test |
| `sample` | `bun run check` | biome check + tsc |

CI (`.github/workflows/ci.yml`) runs the same checks on push/PR to main.

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: fix a bug
chore: maintenance tasks
docs: documentation changes
refactor: code restructuring
test: add or update tests
```

## Release Process

Tag push triggers automatic npm publish via `.github/workflows/publish.yml`.

1. Update `packages/langchain-copilotkit/CHANGELOG.md` with new entries
2. Run version bump:
   ```bash
   cd packages/langchain-copilotkit
   npm version patch  # or minor / major
   ```
3. Commit and push with tags — CI publishes to npm automatically:
   ```bash
   git push --follow-tags
   ```

**Prerequisite:** `NPM_TOKEN` secret must be set in GitHub repository settings.

## Project Structure

```
packages/langchain-copilotkit/   # npm package (published)
sample/                          # Next.js sample app (not published)
```
