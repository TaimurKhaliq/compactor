# Compactor

Compactor is a local-first TypeScript CLI that mines a repository's git history for repeated engineering patterns and turns them into reusable AI coding-agent guidance.

The MVP is deterministic and rule-based. It does not call an LLM API. The goal is to prove the pipeline:

```text
git history -> repeated patterns -> candidate skills -> generated agent guidance
```

## Why

AI coding agents often spend tokens rediscovering the same project conventions: where grid components live, how tests are named, how config is wired, and which validation commands matter. Compactor extracts those repeated patterns from commits and drafts compact guidance that can be reviewed and reused with Codex, Copilot-style agents, or repository `AGENTS.md` files.

## Install

```bash
npm install
npm run build
```

Run locally:

```bash
npm run compactor -- report
```

After publishing or linking, the binary name is:

```bash
compactor report
```

## Commands

### `compactor analyze`

Runs the full pipeline in one shot:

```text
scan -> mine -> generate -> report
```

```bash
compactor analyze
compactor analyze ../some-project
compactor analyze https://github.com/org/repo.git
compactor analyze https://github.com/org/repo.git --limit 100
```

When the target is a remote Git URL, Compactor clones it into:

```text
.compactor/workspaces/<safe-repo-name>
```

If that workspace already exists, Compactor runs `git pull --ff-only` before analysis. Generated output is written inside the checked-out target repository's own `.compactor/` folder.

### `compactor scan`

Reads recent local git history, groups changed files by commit, classifies basic metadata, and writes `.compactor/cache/scan-result.json`.

```bash
compactor scan --limit 50
compactor scan --limit 100 --json
compactor scan --repo ../some-project --limit 25
compactor scan --repo https://github.com/org/repo.git --limit 50
```

Captured metadata includes:

- commit hash and message
- changed files
- file extensions
- likely area: frontend, backend, tests, config, docs, mixed, or unknown
- repeated file path patterns

### `compactor mine`

Detects repeated implementation patterns and writes `.compactor/cache/candidate-skills.json`.

```bash
compactor mine --limit 75
compactor mine --json
```

Current deterministic rules create candidates such as:

- `Build Project Grid` when multiple commits touch files or messages containing `grid`, `kendo`, `table`, or `columns`
- `Add or Update Tests` when multiple commits touch `.spec.ts`, `.test.*`, `playwright`, `e2e`, `cypress`, or `__tests__`
- `Update Runtime Configuration` when multiple commits touch environment, config, JSON, or YAML files
- `Add Angular Feature` when multiple commits touch Angular component and service files together
- `Add API Endpoint` when multiple commits pair API-facing files with tests

### `compactor generate`

Generates markdown drafts into `.compactor/`.

```bash
compactor generate --limit 50
```

Output:

- `.compactor/skills/<skill-id>/SKILL.md`
- `.compactor/AGENTS.md`
- `.compactor/cache/generation-result.json`

Each generated skill includes:

- when to use
- examples
- workflow steps
- observed repo conventions
- validation checklist
- evidence commits

### `compactor report`

Prints a concise terminal report.

```bash
compactor report --limit 50
```

The report includes:

- number of commits analyzed
- candidate skills found
- estimated token-saving rationale
- top repeated patterns

## Example Generated Output

See:

- `examples/generated-output/AGENTS.md`
- `examples/generated-output/skills/build-project-grid/SKILL.md`

## Development

```bash
npm install
npm test
```

Project layout:

```text
src/cli.ts
src/git/history.ts
src/git/repository.ts
src/analysis/classifier.ts
src/analysis/patternMiner.ts
src/skills/skillGenerator.ts
src/report/reportGenerator.ts
src/types.ts
```

## Extension Ideas

- Add embeddings or LLM clustering after the deterministic cache is stable.
- Add package manager detection for validation commands.
- Add richer framework-specific miners for Rails, Django, Next.js, Angular, or .NET.
- Add a review mode that compares generated skills against the current repository `AGENTS.md`.
