import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyCommit, collectRepeatedPathPatterns } from "../src/analysis/classifier.js";
import { learnRepositoryPatterns } from "../src/analysis/repoLearning.js";
import { minePatterns } from "../src/analysis/patternMiner.js";
import { generateSkillExplanation } from "../src/report/explainGenerator.js";
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
