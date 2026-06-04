import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyCommit, collectRepeatedPathPatterns } from "../src/analysis/classifier.js";
import { approveSkill, deprecateSkill, readSkillMetadata, refreshSkills, renderAgentsMarkdownFromMetadata, validateSkills } from "../src/skills/lifecycle.js";
import { generateSkillDrafts } from "../src/skills/skillGenerator.js";
import type { CandidateSkill, DiffSignal, MiningResult, ScanResult } from "../src/types.js";
import { diffSummaryWithSignals, emptyDiffSummary } from "./helpers.js";

test("generates skill metadata and freshness banner", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-lifecycle-"));

  try {
    generateSkillDrafts(baseScan(repoRoot), mining(repoRoot));

    const metadata = readMetadata(repoRoot);
    const skill = readFileSync(join(repoRoot, ".compactor", "skills", "build-project-grid", "SKILL.md"), "utf8");

    assert.equal(metadata.skill_id, "build-project-grid");
    assert.equal(metadata.status, "fresh");
    assert.equal(metadata.generated_from_head, baseHash);
    assert.ok(metadata.pattern_signature.hash);
    assert.deepEqual(metadata.generic_signals, ["component_changed", "ui_changed", "unit_test_changed"]);
    assert.match(skill, /^Status: fresh/);
    assert.match(skill, new RegExp(`Generated from HEAD: ${baseHash}`));
    assert.match(skill, /Evidence commits: 1/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("refresh keeps a skill fresh when new commits support the same pattern", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-lifecycle-"));

  try {
    generateSkillDrafts(baseScan(repoRoot), mining(repoRoot));
    const scan = makeScan(repoRoot, [
      commit("supporting1111111", "Update orders grid", ["src/app/orders/orders-grid.component.ts", "tests/orders-grid.test.ts"], [
        { type: "function_added", value: "OrdersGrid", filePath: "src/app/orders/orders-grid.component.ts" },
        { type: "test_case_added", value: "renders orders grid", filePath: "tests/orders-grid.test.ts" }
      ]),
      baseCommit()
    ]);

    const report = refreshSkills(scan, { now: "2026-01-02T00:00:00Z" });
    const metadata = readMetadata(repoRoot);

    assert.equal(report.fresh.length, 1);
    assert.equal(metadata.status, "fresh");
    assert.equal(metadata.generated_from_head, "supporting1111111");
    assert.ok(metadata.evidence_commits.some((evidence) => evidence.hash === "supporting1111111"));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("refresh marks drift when same broad area shifts signals and directories", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-lifecycle-"));

  try {
    generateSkillDrafts(baseScan(repoRoot), mining(repoRoot));
    const scan = makeScan(repoRoot, [
      commit("drift11111111111", "Add settings screen", ["frontend/src/pages/settings.tsx"], [
        { type: "function_added", value: "SettingsScreen", filePath: "frontend/src/pages/settings.tsx" }
      ]),
      commit("drift22222222222", "Add profile screen", ["frontend/src/pages/profile.tsx"], [
        { type: "function_added", value: "ProfileScreen", filePath: "frontend/src/pages/profile.tsx" }
      ]),
      baseCommit()
    ]);

    const report = refreshSkills(scan, { now: "2026-01-03T00:00:00Z" });
    const metadata = readMetadata(repoRoot);

    assert.equal(report.drifting.length, 1);
    assert.equal(metadata.status, "drifting");
    assert.ok(metadata.drift_reasons?.some((reason) => /directories shifted|Dominant naming terms/.test(reason)));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("validate marks stale when many newer commits have no supporting evidence", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-lifecycle-"));

  try {
    generateSkillDrafts(baseScan(repoRoot), mining(repoRoot));
    const scan = makeScan(repoRoot, [
      commit("docs111111111111", "Update docs one", ["docs/one.md"], []),
      commit("docs222222222222", "Update docs two", ["docs/two.md"], []),
      baseCommit()
    ]);

    const report = validateSkills(scan, { staleCommitThreshold: 2 });

    assert.equal(report.stale.length, 1);
    assert.equal(report.stale[0]?.skill_id, "build-project-grid");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("refresh records validation command changes", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-lifecycle-"));

  try {
    generateSkillDrafts(baseScan(repoRoot), mining(repoRoot));
    const scanWithChangedValidation = {
      ...baseScan(repoRoot),
      validationCommands: ["npm run test"]
    };

    const report = refreshSkills(scanWithChangedValidation, { now: "2026-01-04T00:00:00Z" });
    const metadata = readMetadata(repoRoot);

    assert.equal(report.validationCommandChanges.length, 1);
    assert.equal(metadata.status, "drifting");
    assert.deepEqual(metadata.validation_commands, ["npm run test"]);
    assert.match(metadata.validation_warnings?.[0] ?? "", /Validation commands changed/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("approve and deprecate update metadata and AGENTS excludes deprecated skills", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-lifecycle-"));

  try {
    const base = baseScan(repoRoot);
    generateSkillDrafts(base, mining(repoRoot));

    const approved = approveSkill(repoRoot, "build-project-grid", "2026-01-05T00:00:00Z");
    assert.equal(approved.human_approved, true);
    assert.equal(approved.approved_at, "2026-01-05T00:00:00Z");

    const deprecated = deprecateSkill(repoRoot, "build-project-grid", "2026-01-06T00:00:00Z");
    assert.equal(deprecated.status, "deprecated");

    const agents = renderAgentsMarkdownFromMetadata(base, readSkillMetadata(repoRoot));
    assert.match(agents, /No agent-ready skills were generated/);
    assert.doesNotMatch(agents, /use \.compactor\/skills\/build-project-grid/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("approve promotes a draft skill into trusted skills", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-lifecycle-"));

  try {
    const base = baseScan(repoRoot);
    const draftCandidate = {
      ...candidate(),
      id: "draft-project-grid",
      name: "Add or Update Project Grid Draft",
      promotion_level: "draft" as const,
      workflowQuality: 0.65,
      promotionReasons: ["Pattern confidence is below agent-ready threshold."]
    };
    generateSkillDrafts(base, {
      repoRoot,
      generatedAt: "2026-01-01T00:00:00Z",
      commitsAnalyzed: 1,
      candidates: [draftCandidate]
    });

    assert.equal(existsSync(join(repoRoot, ".compactor", "draft-skills", "draft-project-grid", "SKILL.md")), true);

    const approved = approveSkill(repoRoot, "draft-project-grid", "2026-01-05T00:00:00Z");

    assert.equal(approved.human_approved, true);
    assert.equal(approved.status, "fresh");
    assert.equal(approved.promotion_level, "agent_ready");
    assert.equal(existsSync(join(repoRoot, ".compactor", "draft-skills", "draft-project-grid", "SKILL.md")), false);
    assert.equal(existsSync(join(repoRoot, ".compactor", "skills", "draft-project-grid", "SKILL.md")), true);

    const markdown = readFileSync(join(repoRoot, ".compactor", "skills", "draft-project-grid", "SKILL.md"), "utf8");
    assert.match(markdown, /^Status: fresh/);
    assert.match(markdown, /Human approved: true/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

const baseHash = "base000000000000";

function readMetadata(repoRoot: string) {
  const metadata = readSkillMetadata(repoRoot)[0];
  assert.ok(metadata, "Expected generated skill metadata");
  return metadata;
}

function baseScan(repoRoot: string): ScanResult {
  return makeScan(repoRoot, [baseCommit()]);
}

function baseCommit() {
  return commit(baseHash, "Add orders grid", ["src/app/orders/orders-grid.component.ts", "tests/orders-grid.test.ts"], [
    { type: "function_added", value: "OrdersGrid", filePath: "src/app/orders/orders-grid.component.ts" },
    { type: "test_case_added", value: "renders orders grid", filePath: "tests/orders-grid.test.ts" }
  ]);
}

function makeScan(repoRoot: string, commits: ReturnType<typeof commit>[], validationCommands = ["npm test"]): ScanResult {
  return {
    repoRoot,
    packageScripts: ["test"],
    validationCommands,
    generatedAt: "2026-01-01T00:00:00Z",
    commitsAnalyzed: commits.length,
    commits,
    repeatedPathPatterns: collectRepeatedPathPatterns(commits)
  };
}

function mining(repoRoot: string): MiningResult {
  return {
    repoRoot,
    generatedAt: "2026-01-01T00:00:00Z",
    commitsAnalyzed: 1,
    candidates: [candidate()]
  };
}

function candidate(): CandidateSkill {
  return {
    id: "build-project-grid",
    name: "Build Project Grid",
    taskDescription: "Use this for orders grid UI changes involving components, screens, API client wiring, or related UI tests.",
    outputType: "skill",
    promotion_level: "agent_ready",
    primaryArea: "frontend",
    primaryAreaShare: 1,
    workflowQuality: 0.9,
    generatedArtifactEvidenceShare: 0,
    promotionReasons: ["Promoted to skill."],
    reviewNotes: ["Promoted because the cluster has a dominant area and actionable workflow."],
    patternConfidence: 0.82,
    namingConfidence: 0.74,
    confidence: 0.82,
    evidenceCommits: [
      {
        hash: baseHash,
        shortHash: "base000",
        message: "Add orders grid",
        changedFiles: ["src/app/orders/orders-grid.component.ts"],
        diffSignals: ["function_added:OrdersGrid (src/app/orders/orders-grid.component.ts)"],
        pathSignals: ["ui_changed", "component_changed"]
      }
    ],
    commonFiles: ["src/app/orders/orders-grid.component.ts"],
    commonDirectories: ["src/app/orders", "tests"],
    observedConventions: ["Grid-related changes most often appear under `src/app/orders`."],
    observedChanges: ["Observed function_added:OrdersGrid (src/app/orders/orders-grid.component.ts)."],
    suggestedValidationCommands: ["npm test"],
    genericSignals: ["component_changed", "ui_changed", "unit_test_changed"],
    repeatedTerms: ["grid", "orders"],
    domainTerms: ["grid", "orders"],
    rejectedNoisyTerms: ["component", "test"],
    genericCategory: "UI Component Pattern",
    genericFallbackName: "Add or Update UI Component Feature",
    namingReasons: ["component and frontend/test signals repeated together"],
    frameworkHints: [],
    matchedPatterns: ["component_changed", "unit_test_changed"],
    pathSignals: ["ui_changed", "component_changed"],
    diffSignals: ["function_added:OrdersGrid (src/app/orders/orders-grid.component.ts)"],
    confidenceFactors: ["1 of 1 scanned commits matched this repeated change shape."],
    falsePositiveNotes: ["Review representative commits."],
    rationale: "Multiple commits repeat grid work."
  };
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
