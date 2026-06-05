# Compactor

Compactor is a local-first TypeScript CLI that mines a repository's git history for repeated engineering patterns and turns them into reusable AI coding-agent guidance.

The MVP is deterministic and rule-based. It does not call an LLM API. The goal is to prove the pipeline:

```text
git history + source fingerprints -> repeated patterns -> candidate skills -> generated agent guidance
```

## Why

AI coding agents often spend tokens rediscovering the same project conventions: how API changes are tested, where UI components live, how migrations pair with models, how CI/config changes are validated, and which commands matter. Compactor extracts those repeated patterns from commits and drafts compact guidance that can be reviewed and reused with Codex, Copilot-style agents, or repository `AGENTS.md` files.

## What's New in 0.2.0

Compactor `0.2.0` adds skill lifecycle management so generated guidance can be refreshed, validated, approved, or deprecated as the repository evolves.

- Generated skills now include `metadata.json` sidecars with evidence commits, pattern signatures, confidence scores, validation commands, and freshness status.
- `SKILL.md` files include a freshness banner with status, generated HEAD, last refresh time, and evidence count.
- `compactor refresh` re-sources existing skills from newer commits and marks skills fresh, stale, or drifting.
- `compactor validate-skills` reports stale, drifting, deprecated, and review-needed skills.
- `compactor approve <skill-id>` records human approval.
- `compactor deprecate <skill-id>` keeps a skill on disk but removes it from active agent guidance.

## Installation / Usage

```bash
npx @taimurkhaliq/compactor analyze .
npx @taimurkhaliq/compactor analyze https://github.com/org/repo.git
npx @taimurkhaliq/compactor apply . --target codex
```

You can also install or link it as a normal CLI package:

```bash
npm install -g @taimurkhaliq/compactor
compactor analyze .
```

For local development from this repository:

```bash
npm install
npm run build
npm run compactor -- analyze .
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

### `compactor apply`

Publishes generated Compactor guidance into agent entrypoint files that coding tools already look for.

```bash
compactor apply . --target codex
compactor apply . --target claude
compactor apply . --target cursor
compactor apply . --target copilot
compactor apply . --target all
compactor apply . --target all --dry-run
```

Targets:

- `codex` updates root `AGENTS.md`
- `claude` updates root `CLAUDE.md`
- `cursor` updates `.cursor/rules/compactor.mdc`
- `copilot` updates `.github/copilot-instructions.md`
- `all` applies every supported target

`apply` only edits the managed section between:

```html
<!-- COMPACTOR:START -->
<!-- COMPACTOR:END -->
```

Human-authored content outside those markers is preserved. Approved or agent-ready skills are listed as usable guidance, draft skills are listed separately as review-only context, and pattern candidates are linked as non-agent-ready evidence.

### Human approval flow

Compactor separates generated output into three trust levels:

- `.compactor/skills` contains trusted, agent-ready or human-approved skills.
- `.compactor/draft-skills` contains generated draft skills that need review.
- `.compactor/patterns` contains noisy pattern candidates that are not skills.

Use the review flow before wiring guidance into day-to-day agent behavior:

```bash
compactor review .
compactor approve <draft-skill-id> .
compactor reject <draft-skill-id> .
compactor deprecate <approved-skill-id> .
```

`approve` moves a draft skill into `.compactor/skills`, records `approved_at` and `approved_by`, adds a human-approved banner to `SKILL.md`, regenerates `.compactor/AGENTS.md`, and refreshes any existing root integration files created by `compactor apply`.

`reject` archives an unapproved draft under `.compactor/archive/rejected-skills/`. `deprecate` archives an approved skill under `.compactor/archive/deprecated-skills/` and removes it from active guidance.

You can also turn a pattern candidate into a named draft, then approve it after editing:

```bash
compactor promote-pattern <pattern-id> --name "Update Reporting UI" .
compactor rename-draft <draft-skill-id> --name "Update Reporting Dashboard UI" .
compactor approve <draft-skill-id> .
```

### `compactor explain`

Explains why a candidate skill was generated.

```bash
compactor explain add-or-update-backend-api-feature-api-route-changed-service-layer-changed
compactor explain update-build-or-ci-configuration-ci-changed-config-changed https://github.com/org/repo.git --limit 100
```

The explanation includes:

- evidence commits
- learned surface evidence
- fingerprint pattern-family evidence
- frameworks and libraries detected in fingerprints
- similarity scores and representative files
- path signals
- structured diff signals
- domain terms used for naming
- rejected noisy terms
- generic category and fallback name
- pattern and naming confidence factors
- possible false-positive notes

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
- bounded per-file diff summaries
- file extensions
- likely area: frontend, backend, tests, config, docs, mixed, or unknown
- repeated file path patterns
- generic path signals across frontend, backend, database, infrastructure, tests, and docs
- generic diff signals such as added functions/classes/types, test cases, CLI commands, package scripts, SQL schema/index/query changes, and route/handler patterns visible in added lines
- implementation fingerprints for source files, cached at `.compactor/cache/fingerprints.json`
- implementation pattern families discovered from similar source files, even when those files never changed together

### `compactor mine`

Detects repeated implementation patterns and writes `.compactor/cache/candidate-skills.json`.

```bash
compactor mine --limit 75
compactor mine --json
```

Compactor now mines generic change shapes rather than fixed repo-specific rules. It learns both:

- **Co-change surfaces**: files and directories that repeatedly change together.
- **Implementation pattern families**: files that look structurally similar through imports, framework features, symbols, routes, CLI options, schema/model patterns, component tags, and concepts.

It clusters commits by:

- repeated generic signals, such as `api_route_changed`, `service_layer_changed`, `migration_changed`, `component_changed`, `ci_changed`, or `unit_test_changed`
- overlapping directories and filenames
- repeated commit-message and filename terms
- lightweight framework/language hints

It also clusters source files by fingerprint similarity. This catches patterns such as `user-grid.component.ts`, `profile-grid.component.ts`, and `account-grid.component.ts` that may never co-change but share the same implementation shape.

Fingerprint detectors only extract neutral technology features. A single Angular, React, Spring, Rust, Prisma, or Kendo file does not become a skill by itself; Compactor only promotes repeated pattern families with enough similar files and confidence.

Candidate names are proposed from evidence. Examples:

- `Add or Update Backend API Feature`
- `Add or Update Audit Reporting Backend API Feature`
- `Add or Update Grid Table UI Component Pattern`
- `Add or Update Account Database-Backed Feature`
- `Add or Update Database-Backed Feature`
- `Update Database Schema and Queries`
- `Add or Update Async Job/Event Handler`
- `Add or Update CLI Feature`
- `Add or Update UI Component Feature`
- `Update Build or CI Configuration`
- fallback names such as `Update Backend and Test Pattern` or `Update Full-Stack Feature Pattern` when semantic naming confidence is lower

When repeated repository vocabulary is strong enough, Compactor combines it with the generic category. It mines domain terms from commit messages, filenames, directories, and added function/class/test names, then filters noisy terms such as `add`, `update`, `test`, `src`, `component`, `service`, route verbs, and SQL syntax words.

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

- proposed skill name
- pattern confidence and naming confidence
- when to use
- why Compactor proposed it
- naming explanation with domain terms, rejected noisy terms, generic category, and fallback name
- generic signals detected
- common files/directories
- repeated terms
- nearest examples
- observed changes from diffs
- validation commands
- top 5 representative evidence commits
- possible false-positive notes

Validation commands are generated only when Compactor can discover them from the target repository, including package scripts, Makefile targets, Maven/Gradle files, Python test hints, Go/.NET/Rust project files, and simple CI workflow commands.

### Skill lifecycle

Generated skills include `metadata.json` sidecars and a freshness banner. Use lifecycle commands to keep generated guidance from going stale:

```bash
compactor refresh
compactor validate-skills
compactor review
compactor approve <skill-id>
compactor reject <skill-id>
compactor deprecate <skill-id>
compactor promote-pattern <pattern-id> --name "Skill name"
compactor rename-draft <skill-id> --name "Skill name"
```

`refresh` re-sources existing skills from commits after the last generated HEAD, updates supporting evidence, and marks skills stale or drifting when patterns move. `validate-skills` reports fresh, stale, drifting, deprecated, and review-needed skills without changing skill files. `review` prints a dashboard for drafts and patterns. `approve` moves a draft into trusted skills, `reject` archives an unapproved draft, and `deprecate` archives a trusted skill so agents no longer use it.

### `compactor report`

Prints a concise terminal report.

```bash
compactor report --limit 50
```

The report includes:

- number of commits analyzed
- candidate skills found
- pattern families discovered
- estimated token-saving rationale
- top repeated patterns

## Example Generated Output

See:

- `examples/generated-output/AGENTS.md`
- `examples/generated-output/skills/add-or-update-backend-api-feature/SKILL.md`

## Development

```bash
npm install
npm test
```

Project layout:

```text
src/cli.ts
src/git/history.ts
src/git/diffParser.ts
src/git/packageScripts.ts
src/git/repository.ts
src/analysis/genericSignals.ts
src/analysis/classifier.ts
src/analysis/implementationFingerprints.ts
src/analysis/detectors/
src/analysis/patternMiner.ts
src/skills/skillGenerator.ts
src/skills/lifecycle.ts
src/report/reportGenerator.ts
src/types.ts
```

## Extension Ideas

- Add embeddings or LLM clustering after the deterministic cache is stable.
- Add richer semantic grouping for framework-specific conventions after the generic signal cache is stable.
- Add a review mode that compares generated skills against the current repository `AGENTS.md`.
