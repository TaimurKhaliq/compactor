import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyCommit, collectRepeatedPathPatterns } from "../src/analysis/classifier.js";
import { learnRepositoryPatterns } from "../src/analysis/repoLearning.js";
import { minePatterns } from "../src/analysis/patternMiner.js";
import { generateSkillExplanation } from "../src/report/explainGenerator.js";
import { renderSkillMarkdown } from "../src/skills/skillGenerator.js";
import type { DiffSignal, ScanResult } from "../src/types.js";
import { diffSummaryWithSignals, emptyDiffSummary } from "./helpers.js";

test("learns a Rust commands surface without Rust-specific CLI rules", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-rust-surface-"));

  try {
    writeFileSync(join(repoRoot, "Cargo.toml"), "[package]\nname = \"demo\"\n");
    const commits = Array.from({ length: 4 }, (_, index) => commit(`${index + 1}`.repeat(16), `Update repair command ${index}`, [
      `src/commands/repair_${index}.rs`,
      `tests/commands/repair_${index}_test.rs`
    ], []));
    const result = scan(commits, repoRoot);
    const learning = learnRepositoryPatterns(result);
    const commands = learning.surfaces.find((surface) => surface.commonDirectory === "src/commands");

    assert.ok(commands);
    assert.match(commands.displayName, /Command/);
    assert.ok(commands.representativeFiles.includes("src/commands/repair_0.rs"));
    assert.ok(commands.coChangingTestFiles.includes("tests/commands/repair_0_test.rs"));
    assert.deepEqual(commands.validationCommands, ["cargo test"]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("repeated files under any source directory can become a learned surface", () => {
  const commits = Array.from({ length: 3 }, (_, index) => commit(`${index + 1}`.repeat(16), `Update widget mapper ${index}`, [
    `engine/widgets/widget_${index}.rb`,
    `spec/widgets/widget_${index}_spec.rb`
  ], []));

  const learning = learnRepositoryPatterns(scan(commits));
  const surface = learning.surfaces.find((candidate) => candidate.commonDirectory === "engine/widgets");

  assert.ok(surface);
  assert.equal(surface.roleCounts.source >= 1, true);
  assert.ok(surface.coChangingTestFiles.some((file) => file.startsWith("spec/widgets/")));
});

test("generated artifacts do not become learned surfaces", () => {
  const commits = Array.from({ length: 4 }, (_, index) => commit(`${index + 1}`.repeat(16), `Update generated report ${index}`, [
    `reports/audit-${index}.report.json`,
    `generated/state-${index}.json`,
    `coverage/out-${index}.json`
  ], []));

  const learning = learnRepositoryPatterns(scan(commits));

  assert.equal(learning.surfaces.length, 0);
  assert.equal(learning.fileRoles["reports/audit-0.report.json"], "generated");
  assert.equal(learning.fileRoles["coverage/out-0.json"], "build-output");
});

test("generated artifacts do not create co-change edges", () => {
  const commits = Array.from({ length: 3 }, (_, index) => commit(`${index + 1}`.repeat(16), `Update bundle command ${index}`, [
    `grit/src/commands/bundle_${index}.rs`,
    `grit/tests/commands/bundle_${index}_test.rs`,
    "data/test-files.csv",
    "docs/progress/index.html",
    `logs/run-${index}.txt`,
    "test-results.md"
  ], []));

  const learning = learnRepositoryPatterns(scan(commits));
  const allCoChangeFiles = learning.strongestCoChangePairs.flatMap((edge) => edge.files);

  assert.equal(allCoChangeFiles.some((file) => /data\/test-files\.csv|docs\/progress|logs\/|test-results\.md/.test(file)), false);
});

test("source and test co-change can promote without a language-specific detector", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-rust-promote-"));

  try {
    writeFileSync(join(repoRoot, "Cargo.toml"), "[package]\nname = \"demo\"\n");
    const commits = Array.from({ length: 4 }, (_, index) => commit(`${index + 1}`.repeat(16), `Update repair workflow ${index}`, [
      `src/commands/repair_${index}.rs`,
      `tests/commands/repair_${index}_test.rs`
    ], []));

    const result = minePatterns(scan(commits, repoRoot));
    const candidate = result.candidates[0];

    assert.ok(candidate);
    assert.notEqual(candidate.promotion_level, "pattern_candidate");
    assert.equal(candidate.learnedSurface?.commonDirectory, "src/commands");
    assert.ok(candidate.suggestedValidationCommands.includes("cargo test"));
    assert.match(candidate.name, /Commands|Repair/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("surface skills reject docs progress only commits from evidence", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-surface-evidence-"));

  try {
    writeFileSync(join(repoRoot, "Cargo.toml"), "[package]\nname = \"grit\"\n");
    const surfaceCommits = ["diff", "bundle", "log", "rebase"].map((name, index) => commit(`${index + 1}`.repeat(16), `Update ${name} command with progress artifacts`, [
      `grit/src/commands/${name}.rs`,
      `grit/tests/commands/${name}_test.rs`,
      "docs/progress/index.html",
      "data/test-files.csv"
    ], [
      { type: "function_added", value: `${name}Command`, filePath: `grit/src/commands/${name}.rs` },
      { type: "test_case_added", value: `${name} command`, filePath: `grit/tests/commands/${name}_test.rs` }
    ]));
    const noisyCommits = ["aaaa", "bbbb", "cccc"].map((hash, index) => commit(hash.repeat(4), `Update progress report noise ${index}`, [
      "docs/progress/index.html",
      "data/test-files.csv",
      `logs/run-${index}.txt`,
      "test-results.md"
    ], []));

    const result = minePatterns(scan([...surfaceCommits, ...noisyCommits], repoRoot));
    const candidate = result.candidates.find((skill) => skill.learnedSurface?.commonDirectory === "grit/src/commands");

    assert.ok(candidate);
    assert.equal(candidate.promotion_level, "agent_ready");
    assert.equal(candidate.evidenceCommits.some((evidence) => evidence.changedFiles.some((file) => /docs\/progress|data\/test-files|logs\/|test-results/.test(file))), false);
    assert.equal(candidate.evidenceCommits.some((evidence) => noisyCommits.some((commit) => commit.hash === evidence.hash)), false);
    assert.equal(candidate.rejectedEvidenceCommitCount, 3);
    assert.equal(candidate.surfaceEvidenceCommits?.length, 4);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("common areas and co-change evidence prefer the learned commands surface", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-surface-common-"));

  try {
    writeFileSync(join(repoRoot, "Cargo.toml"), "[package]\nname = \"grit\"\n");
    const commits = ["diff", "bundle", "log", "rebase"].map((name, index) => commit(`${index + 1}`.repeat(16), `Update ${name} command`, [
      `grit/src/commands/${name}.rs`,
      `grit/tests/commands/${name}_test.rs`,
      "docs/progress/index.html",
      "data/test-files.csv"
    ], []));

    const result = minePatterns(scan(commits, repoRoot));
    const candidate = result.candidates.find((skill) => skill.learnedSurface?.commonDirectory === "grit/src/commands");

    assert.ok(candidate);
    assert.equal(candidate.commonDirectories[0], "grit/src/commands");
    assert.equal(candidate.commonDirectories.some((directory) => /docs|data/.test(directory)), false);
    assert.equal(candidate.learnedSurface?.coChangeEvidence.some((edge) => edge.files.some((file) => /docs\/progress|data\/test-files/.test(file))), false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("surface skill demotes when fewer than three direct surface commits remain", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-surface-demote-"));

  try {
    writeFileSync(join(repoRoot, "Cargo.toml"), "[package]\nname = \"grit\"\n");
    const surfaceCommits = ["diff", "bundle"].map((name, index) => commit(`${index + 1}`.repeat(16), `Update ${name} command with progress artifacts`, [
      `grit/src/commands/${name}.rs`,
      `grit/tests/commands/${name}_test.rs`,
      "docs/progress/index.html"
    ], []));
    const noisyCommits = ["aaaa", "bbbb", "cccc"].map((hash, index) => commit(hash.repeat(4), `Update progress report noise ${index}`, [
      "docs/progress/index.html",
      "data/test-files.csv",
      `logs/run-${index}.txt`
    ], []));

    const result = minePatterns(scan([...surfaceCommits, ...noisyCommits], repoRoot));
    const candidate = result.candidates.find((skill) => skill.learnedSurface?.commonDirectory === "grit/src/commands");

    assert.ok(candidate);
    assert.equal(candidate.promotion_level, "pattern_candidate");
    assert.ok(candidate.promotionReasons.some((reason) => /Only 2 evidence commits/.test(reason)));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("learned commands surface drives skill name and task area", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-command-name-"));

  try {
    writeFileSync(join(repoRoot, "Cargo.toml"), "[package]\nname = \"grit\"\n");
    const commits = ["diff", "bundle", "log", "rebase"].map((name, index) => commit(`${index + 1}`.repeat(16), `Update ${name} command`, [
      `grit/src/commands/${name}.rs`,
      `grit/tests/commands/${name}_test.rs`
    ], []));

    const result = minePatterns(scan(commits, repoRoot));
    const candidate = result.candidates[0];

    assert.ok(candidate);
    assert.equal(candidate.learnedSurface?.commonDirectory, "grit/src/commands");
    assert.equal(candidate.learnedSurface?.taskKind, "commands");
    assert.equal(candidate.primaryArea, "cli");
    assert.equal(candidate.name, "Update Commands");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("generated docs progress and data terms cannot produce UI names for a commands surface", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-command-noise-"));

  try {
    writeFileSync(join(repoRoot, "Cargo.toml"), "[package]\nname = \"grit\"\n");
    const commits = ["diff", "bundle", "log", "rebase"].map((name, index) => commit(`${index + 1}`.repeat(16), `Update data progress UI notes for ${name}`, [
      `grit/src/commands/${name}.rs`,
      `grit/tests/commands/${name}_test.rs`,
      `grit/ui/src/components/progress-data-${index}.tsx`,
      `grit/docs/progress-data-${index}.md`,
      `grit/generated/progress-data-${index}.report.json`
    ], [
      { type: "function_added", value: `${name}Command`, filePath: `grit/src/commands/${name}.rs` },
      { type: "function_added", value: `ProgressData${index}`, filePath: `grit/ui/src/components/progress-data-${index}.tsx` },
      { type: "test_case_added", value: `${name} command`, filePath: `grit/tests/commands/${name}_test.rs` }
    ]));

    const result = minePatterns(scan(commits, repoRoot));
    const candidate = result.candidates[0];

    assert.ok(candidate);
    assert.equal(candidate.learnedSurface?.commonDirectory, "grit/src/commands");
    assert.equal(candidate.learnedSurface?.taskKind, "commands");
    assert.equal(candidate.primaryArea, "cli");
    assert.equal(candidate.name, "Update Commands");
    assert.doesNotMatch(candidate.name, /Data|Progress|UI/);
    assert.equal(candidate.learnedSurface.sourceTerms?.includes("data"), false);
    assert.equal(candidate.learnedSurface.sourceTerms?.includes("progress"), false);
    assert.equal(candidate.promotion_level, "agent_ready");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("strong learned surface overrides mixed global signals", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-command-mixed-"));

  try {
    writeFileSync(join(repoRoot, "Cargo.toml"), "[package]\nname = \"grit\"\n");
    const commits = ["diff", "bundle", "log", "rebase"].map((name, index) => commit(`${index + 1}`.repeat(16), `Update ${name} command with docs and config`, [
      `grit/src/commands/${name}.rs`,
      `grit/tests/commands/${name}_test.rs`,
      `docs/${name}.md`,
      `config/${name}.json`,
      `generated/${name}.report.json`
    ], [
      { type: "config_changed", value: `${name}ProgressData`, filePath: `config/${name}.json` },
      { type: "test_case_added", value: `${name} command`, filePath: `grit/tests/commands/${name}_test.rs` }
    ]));

    const result = minePatterns(scan(commits, repoRoot));
    const candidate = result.candidates[0];

    assert.ok(candidate);
    assert.equal(candidate.primaryArea, "cli");
    assert.notEqual(candidate.promotion_level, "pattern_candidate");
    assert.equal(candidate.learnedSurface?.taskKind, "commands");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("validation commands are discovered from the nearest project files for a surface", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-surface-validation-"));

  try {
    mkdirSync(join(repoRoot, "tools"), { recursive: true });
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ scripts: { test: "pytest" } }));
    writeFileSync(join(repoRoot, "tools", "Cargo.toml"), "[package]\nname = \"tools\"\n");
    const commits = Array.from({ length: 3 }, (_, index) => commit(`${index + 1}`.repeat(16), `Update tool runner ${index}`, [
      `tools/src/runner_${index}.rs`,
      `tools/tests/runner_${index}_test.rs`
    ], []));

    const result = minePatterns(scan(commits, repoRoot));
    const candidate = result.candidates[0];

    assert.ok(candidate);
    assert.deepEqual(candidate.suggestedValidationCommands, ["cargo test"]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("repeated CLI option actions produce command-specific workflow", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-cli-workflow-"));

  try {
    writeFileSync(join(repoRoot, "Cargo.toml"), "[package]\nname = \"grit\"\n");
    const commits = ["bundle", "diff", "log"].map((name, index) => commit(`${index + 1}`.repeat(16), `Update ${name} command option`, [
      `grit/src/commands/${name}.rs`,
      `grit/tests/commands/${name}_test.rs`
    ], [
      { type: "cli_command_changed", value: "--format", filePath: `grit/src/commands/${name}.rs` },
      { type: "function_added", value: `${name}Command`, filePath: `grit/src/commands/${name}.rs` },
      { type: "test_case_added", value: `${name} command option`, filePath: `grit/tests/commands/${name}_test.rs` }
    ]));

    const candidate = requireCandidate(minePatterns(scan(commits, repoRoot)).candidates, (skill) => skill.learnedSurface?.taskKind === "commands");
    const markdown = renderSkillMarkdown(candidate);

    assert.match(markdown, /Add or update command option parsing/);
    assert.match(markdown, /Update command handler behavior/);
    assert.match(markdown, /Add or update command tests/);
    assert.match(markdown, /Run the discovered validation command/);
    assert.doesNotMatch(markdown, /Update documentation that directly describes/);
    assert.ok(candidate.workflowQuality >= 0.75);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("repeated UI component actions produce UI-specific workflow without unsupported style steps", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-ui-workflow-"));

  try {
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
    const commits = Array.from({ length: 3 }, (_, index) => commit(`${index + 1}`.repeat(16), `Update reporting component ${index}`, [
      `ui/src/components/reporting/ReportPanel${index}.tsx`,
      "ui/src/api.ts",
      `ui/tests/report-panel-${index}.test.ts`
    ], [
      { type: "function_added", value: `ReportPanel${index}`, filePath: `ui/src/components/reporting/ReportPanel${index}.tsx` },
      { type: "function_added", value: `loadReport${index}`, filePath: "ui/src/api.ts" },
      { type: "test_case_added", value: `shows report panel ${index}`, filePath: `ui/tests/report-panel-${index}.test.ts` }
    ]));

    const candidate = requireCandidate(minePatterns(scan(commits, repoRoot)).candidates, (skill) => skill.learnedSurface?.taskKind === "ui");
    const markdown = renderSkillMarkdown(candidate);

    assert.match(markdown, /Update component, screen, or view behavior/);
    assert.match(markdown, /Update API\/client wiring/);
    assert.match(markdown, /Add or update UI tests/);
    assert.doesNotMatch(markdown, /Update styles/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("API surface workflow uses route and test actions instead of UI steps", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-api-workflow-"));

  try {
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
    const commits = Array.from({ length: 3 }, (_, index) => commit(`${index + 1}`.repeat(16), `Update user route ${index}`, [
      `src/routes/users${index}.ts`,
      `src/services/users${index}.ts`,
      `tests/users${index}.integration.test.ts`
    ], [
      { type: "api_route_changed", value: `GET /users/${index}`, filePath: `src/routes/users${index}.ts` },
      { type: "function_added", value: `loadUsers${index}`, filePath: `src/services/users${index}.ts` },
      { type: "test_case_added", value: `loads users ${index}`, filePath: `tests/users${index}.integration.test.ts` }
    ]));

    const candidate = requireCandidate(minePatterns(scan(commits, repoRoot)).candidates, (skill) => skill.learnedSurface?.taskKind === "api");
    const markdown = renderSkillMarkdown(candidate);

    assert.match(markdown, /Update route, controller, or handler behavior/);
    assert.match(markdown, /Add or update API tests/);
    assert.doesNotMatch(markdown, /Update component, screen, or view behavior/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("docs surface workflow uses docs actions", () => {
  const commits = Array.from({ length: 3 }, (_, index) => commit(`${index + 1}`.repeat(16), `Update install docs ${index}`, [
    `docs/guides/install-${index}.md`
  ], []));

  const candidate = requireCandidate(minePatterns(scan(commits)).candidates, (skill) => skill.learnedSurface?.taskKind === "docs");
  const markdown = renderSkillMarkdown(candidate);

  assert.match(markdown, /Update the documentation files in this learned docs surface/);
  assert.doesNotMatch(markdown, /Update source behavior in the learned surface/);
});

test("generated artifact actions do not drive workflow", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-workflow-noise-"));

  try {
    writeFileSync(join(repoRoot, "Cargo.toml"), "[package]\nname = \"grit\"\n");
    const commits = ["bundle", "diff", "log"].map((name, index) => commit(`${index + 1}`.repeat(16), `Update ${name} command with generated report`, [
      `grit/src/commands/${name}.rs`,
      `grit/tests/commands/${name}_test.rs`,
      "docs/progress/index.html",
      "data/test-files.csv",
      `reports/${name}.report.json`
    ], [
      { type: "function_added", value: `${name}Command`, filePath: `grit/src/commands/${name}.rs` },
      { type: "config_changed", value: "progressReport", filePath: `reports/${name}.report.json` },
      { type: "test_case_added", value: `${name} command`, filePath: `grit/tests/commands/${name}_test.rs` }
    ]));

    const candidate = requireCandidate(minePatterns(scan(commits, repoRoot)).candidates, (skill) => skill.learnedSurface?.taskKind === "commands");
    const actions = candidate.workflowProfile?.actions.map((action) => action.action) ?? [];
    const markdown = renderSkillMarkdown(candidate);

    assert.equal(actions.includes("changed_config_key"), false);
    assert.equal(actions.includes("updated_docs"), false);
    assert.doesNotMatch(markdown, /Update configuration keys/);
    assert.doesNotMatch(markdown, /Update documentation/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("explain output shows learned surface and co-change evidence", () => {
  const commits = Array.from({ length: 4 }, (_, index) => commit(`${index + 1}`.repeat(16), `Update worker flow ${index}`, [
    `workers/flow_${index}.go`,
    `tests/worker_flow_${index}.test.go`
  ], []));
  const mining = minePatterns(scan(commits));
  const candidate = mining.candidates[0];
  assert.ok(candidate);

  const output = generateSkillExplanation(candidate.id, mining);

  assert.match(output, /Learned surface:/);
  assert.match(output, /Co-changing|Co-change/);
  assert.match(output, /Role counts:/);
});

function requireCandidate<T>(candidates: T[], predicate: (candidate: T) => boolean): T {
  const candidate = candidates.find(predicate);
  assert.ok(candidate);
  return candidate;
}

function commit(hash: string, message: string, changedFiles: string[], signals: DiffSignal[]) {
  return classifyCommit({
    hash,
    date: "2026-01-01T00:00:00Z",
    message,
    diffSummary: signals.length > 0 ? diffSummaryWithSignals(signals) : emptyDiffSummary(),
    changedFiles
  });
}

function scan(commits: ReturnType<typeof commit>[], repoRoot = "/tmp/example"): ScanResult {
  return {
    repoRoot,
    packageScripts: [],
    validationCommands: [],
    generatedAt: "2026-01-05T00:00:00Z",
    commitsAnalyzed: commits.length,
    commits,
    repeatedPathPatterns: collectRepeatedPathPatterns(commits)
  };
}
