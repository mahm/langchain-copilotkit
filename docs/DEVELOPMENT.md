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

Manual npm publish workflow:

1. Update `packages/langchain-copilotkit/CHANGELOG.md` with new entries under `## [Unreleased]`
2. Run version bump (this moves Unreleased to a versioned heading, creates a git tag):
   ```bash
   cd packages/langchain-copilotkit
   npm version patch  # or minor / major
   ```
3. Push with tags:
   ```bash
   git push --follow-tags
   ```
4. Publish to npm:
   ```bash
   cd packages/langchain-copilotkit
   npm publish
   ```

## Project Structure

```
packages/langchain-copilotkit/   # npm package (published)
sample/                          # Next.js sample app (not published)
```
