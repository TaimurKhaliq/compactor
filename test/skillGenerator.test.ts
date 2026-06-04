import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateSkillDrafts, renderPatternMarkdown, renderSkillMarkdown } from "../src/skills/skillGenerator.js";
import type { CandidateSkill, MiningResult, ScanResult } from "../src/types.js";

test("renders practical skill markdown", () => {
  const markdown = renderSkillMarkdown(sampleCandidate());

  assert.match(markdown, /^# Build Project Grid/m);
  assert.match(markdown, /Pattern confidence: 82%/);
  assert.match(markdown, /Naming confidence: 74%/);
  assert.match(markdown, /## When to use/);
  assert.match(markdown, /Use this when modifying/);
  assert.match(markdown, /## Relevant examples/);
  assert.match(markdown, /## Workflow/);
  assert.match(markdown, /1\. Start from the nearest relevant example/);
  assert.match(markdown, /## Evidence/);
  assert.match(markdown, /abc1234/);
  assert.doesNotMatch(markdown, /## Generic signals detected/);
});

test("limits rendered evidence to five commits", () => {
  const candidate = sampleCandidate();
  candidate.evidenceCommits = Array.from({ length: 7 }, (_, index) => ({
    hash: `${index}`.repeat(12),
    shortHash: `commit${index}`,
    message: `Commit ${index}`,
    changedFiles: [`src/file-${index}.ts`],
    diffSignals: [],
    pathSignals: []
  }));

  const markdown = renderSkillMarkdown(candidate);
  assert.match(markdown, /commit0/);
  assert.match(markdown, /commit4/);
  assert.doesNotMatch(markdown, /commit5/);
});

test("relevant examples prioritize source files before tests", () => {
  const candidate = sampleCandidate({
    commonFiles: [
      "ui/tests/reporting-dashboard.test.tsx",
      "ui/src/api.ts",
      "docs/reporting.md"
    ],
    evidenceCommits: [
      {
        hash: "abc123456789",
        shortHash: "abc1234",
        message: "Update reporting dashboard",
        changedFiles: [
          "ui/tests/reporting-dashboard.test.tsx",
          "ui/src/components/ReportingDashboard.tsx",
          "ui/src/api.ts"
        ],
        diffSignals: [],
        pathSignals: []
      }
    ]
  });

  const markdown = renderSkillMarkdown(candidate);
  const componentIndex = markdown.indexOf("- ui/src/components/ReportingDashboard.tsx");
  const testIndex = markdown.indexOf("- ui/tests/reporting-dashboard.test.tsx");

  assert.ok(componentIndex > -1, "Expected source component example");
  assert.ok(testIndex > -1, "Expected test example");
  assert.ok(componentIndex < testIndex, "Expected source examples before tests");
});

test("generates skill files and AGENTS draft", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-test-"));

  try {
    const scan: ScanResult = {
      repoRoot,
      packageScripts: ["test"],
      validationCommands: ["npm test"],
      generatedAt: "2026-01-01T00:00:00Z",
      commitsAnalyzed: 2,
      commits: [],
      repeatedPathPatterns: []
    };
    const mining: MiningResult = {
      repoRoot,
      generatedAt: "2026-01-01T00:00:00Z",
      commitsAnalyzed: 2,
      candidates: [sampleCandidate()]
    };

    const result = generateSkillDrafts(scan, mining);
    assert.equal(result.skillFiles.length, 1);
    assert.equal(result.patternFiles.length, 0);

    const skill = readFileSync(join(repoRoot, ".compactor", "skills", "build-project-grid", "SKILL.md"), "utf8");
    const metadata = readFileSync(join(repoRoot, ".compactor", "skills", "build-project-grid", "metadata.json"), "utf8");
    const agents = readFileSync(join(repoRoot, ".compactor", "AGENTS.md"), "utf8");

    assert.match(skill, /^Status: fresh/);
    assert.match(skill, /# Build Project Grid/);
    assert.match(metadata, /"skill_id": "build-project-grid"/);
    assert.match(metadata, /"status": "fresh"/);
    assert.match(agents, /Compactor Draft Repo Guidance/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("generates draft skills separately and AGENTS separates all tiers", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-test-"));

  try {
    const scan: ScanResult = {
      repoRoot,
      packageScripts: ["test"],
      validationCommands: ["npm test"],
      generatedAt: "2026-01-01T00:00:00Z",
      commitsAnalyzed: 6,
      commits: [],
      repeatedPathPatterns: []
    };
    const draft = sampleCandidate({
      id: "draft-grid",
      name: "Add or Update Grid UI Component Pattern",
      promotion_level: "draft",
      workflowQuality: 0.65,
      promotionReasons: ["Pattern confidence is below agent-ready threshold."]
    });
    const pattern = sampleCandidate({
      id: "mixed-ui-test-changes",
      name: "Mixed UI/Test Changes",
      outputType: "pattern",
      promotion_level: "pattern_candidate",
      promotionReasons: ["Cluster mixes too many unrelated signal areas."]
    });
    const result = generateSkillDrafts(scan, {
      repoRoot,
      generatedAt: "2026-01-01T00:00:00Z",
      commitsAnalyzed: 6,
      candidates: [sampleCandidate(), draft, pattern]
    });

    assert.equal(result.skillFiles.length, 1);
    assert.equal(result.draftSkillFiles.length, 1);
    assert.equal(result.patternFiles.length, 1);

    const draftMarkdown = readFileSync(join(repoRoot, ".compactor", "draft-skills", "draft-grid", "SKILL.md"), "utf8");
    const agents = readFileSync(join(repoRoot, ".compactor", "AGENTS.md"), "utf8");

    assert.match(draftMarkdown, /^Status: draft/);
    assert.match(draftMarkdown, /This is a generated draft skill/);
    assert.match(draftMarkdown, /Is the name correct/);
    assert.match(agents, /## Approved \/ agent-ready skills/);
    assert.match(agents, /\.compactor\/skills\/build-project-grid\/SKILL.md/);
    assert.match(agents, /## Draft skills needing review/);
    assert.match(agents, /\.compactor\/draft-skills\/draft-grid\/SKILL.md/);
    assert.match(agents, /## Pattern candidates/);
    assert.match(agents, /\.compactor\/patterns\/mixed-ui-test-changes\/PATTERN.md/);
    assert.doesNotMatch(agents, /backend_changed|cli_command_changed|component_changed/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("writes noisy clusters as pattern candidates instead of skill files", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-test-"));

  try {
    const scan: ScanResult = {
      repoRoot,
      packageScripts: [],
      validationCommands: [],
      generatedAt: "2026-01-01T00:00:00Z",
      commitsAnalyzed: 2,
      commits: [],
      repeatedPathPatterns: []
    };
    const pattern = {
      ...sampleCandidate(),
      outputType: "pattern" as const,
      promotion_level: "pattern_candidate" as const,
      promotionReasons: ["Cluster mixes too many unrelated signal areas."],
      reviewNotes: ["Not promoted to a skill."]
    };
    const mining: MiningResult = {
      repoRoot,
      generatedAt: "2026-01-01T00:00:00Z",
      commitsAnalyzed: 2,
      candidates: [pattern]
    };

    const result = generateSkillDrafts(scan, mining);
    assert.equal(result.skillFiles.length, 0);
    assert.equal(result.patternFiles.length, 1);
    assert.equal(existsSync(join(repoRoot, ".compactor", "skills")), false);

    const patternDir = readdirSync(join(repoRoot, ".compactor", "patterns"))[0];
    assert.ok(patternDir, "Expected generated pattern directory");
    const markdown = readFileSync(join(repoRoot, ".compactor", "patterns", patternDir, "PATTERN.md"), "utf8");
    assert.match(markdown, /# Pattern Candidate: UI Changes/);
    assert.match(markdown, /This is not a skill/);
    assert.doesNotMatch(markdown, /Add or Update|Feature|Skill/);
    assert.match(markdown, /Cluster mixes too many unrelated signal areas/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("archives stale generated skills that are no longer promoted", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-test-"));

  try {
    const scan: ScanResult = {
      repoRoot,
      packageScripts: [],
      validationCommands: [],
      generatedAt: "2026-01-01T00:00:00Z",
      commitsAnalyzed: 2,
      commits: [],
      repeatedPathPatterns: []
    };
    const promotedMining: MiningResult = {
      repoRoot,
      generatedAt: "2026-01-01T00:00:00Z",
      commitsAnalyzed: 2,
      candidates: [sampleCandidate(), sampleCandidate({ id: "build-order-filter", name: "Build Order Filter" })]
    };
    generateSkillDrafts(scan, promotedMining);

    const demotedMining: MiningResult = {
      repoRoot,
      generatedAt: "2026-01-02T00:00:00Z",
      commitsAnalyzed: 2,
      candidates: [{
        ...sampleCandidate(),
        outputType: "pattern",
        promotion_level: "pattern_candidate",
        promotionReasons: ["Cluster mixes too many unrelated signal areas."]
      }]
    };
    const result = generateSkillDrafts(scan, demotedMining);

    assert.equal(result.archivedSkillCount, 2);
    assert.equal(existsSync(join(repoRoot, ".compactor", "skills")), false);
    const archiveEntries = readdirSync(join(repoRoot, ".compactor", "archive", "skills"));
    assert.equal(archiveEntries.length, 2);
    assert.ok(archiveEntries.some((entry) => /^build-project-grid-/.test(entry)));
    assert.ok(archiveEntries.some((entry) => /^build-order-filter-/.test(entry)));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("preserves human-approved skills during cleanup", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-test-"));

  try {
    const scan: ScanResult = {
      repoRoot,
      packageScripts: [],
      validationCommands: [],
      generatedAt: "2026-01-01T00:00:00Z",
      commitsAnalyzed: 2,
      commits: [],
      repeatedPathPatterns: []
    };
    generateSkillDrafts(scan, {
      repoRoot,
      generatedAt: "2026-01-01T00:00:00Z",
      commitsAnalyzed: 2,
      candidates: [sampleCandidate()]
    });

    const metadataPath = join(repoRoot, ".compactor", "skills", "build-project-grid", "metadata.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as Record<string, unknown>;
    writeFileSync(metadataPath, JSON.stringify({ ...metadata, human_approved: true }, null, 2), "utf8");

    const result = generateSkillDrafts(scan, {
      repoRoot,
      generatedAt: "2026-01-02T00:00:00Z",
      commitsAnalyzed: 2,
      candidates: [{
        ...sampleCandidate(),
        outputType: "pattern",
        promotion_level: "pattern_candidate",
        promotionReasons: ["Cluster mixes too many unrelated signal areas."]
      }]
    });

    assert.equal(result.archivedSkillCount, 0);
    assert.equal(existsSync(join(repoRoot, ".compactor", "skills", "build-project-grid", "SKILL.md")), true);
    const agents = readFileSync(join(repoRoot, ".compactor", "AGENTS.md"), "utf8");
    assert.match(agents, /Build Project Grid/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("does not count preserved human-approved skills as archived", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-test-"));

  try {
    const scan: ScanResult = {
      repoRoot,
      packageScripts: [],
      validationCommands: [],
      generatedAt: "2026-01-01T00:00:00Z",
      commitsAnalyzed: 2,
      commits: [],
      repeatedPathPatterns: []
    };
    generateSkillDrafts(scan, {
      repoRoot,
      generatedAt: "2026-01-01T00:00:00Z",
      commitsAnalyzed: 2,
      candidates: [sampleCandidate(), sampleCandidate({ id: "build-order-filter", name: "Build Order Filter" })]
    });

    const metadataPath = join(repoRoot, ".compactor", "skills", "build-project-grid", "metadata.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as Record<string, unknown>;
    writeFileSync(metadataPath, JSON.stringify({ ...metadata, human_approved: true }, null, 2), "utf8");

    const result = generateSkillDrafts(scan, {
      repoRoot,
      generatedAt: "2026-01-02T00:00:00Z",
      commitsAnalyzed: 2,
      candidates: []
    });

    assert.equal(result.archivedSkillCount, 1);
    assert.equal(existsSync(join(repoRoot, ".compactor", "skills", "build-project-grid", "SKILL.md")), true);
    assert.equal(existsSync(join(repoRoot, ".compactor", "skills", "build-order-filter", "SKILL.md")), false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("preserves manually managed skills during cleanup", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-test-"));

  try {
    const scan: ScanResult = {
      repoRoot,
      packageScripts: [],
      validationCommands: [],
      generatedAt: "2026-01-01T00:00:00Z",
      commitsAnalyzed: 2,
      commits: [],
      repeatedPathPatterns: []
    };
    generateSkillDrafts(scan, {
      repoRoot,
      generatedAt: "2026-01-01T00:00:00Z",
      commitsAnalyzed: 2,
      candidates: [sampleCandidate()]
    });

    const metadataPath = join(repoRoot, ".compactor", "skills", "build-project-grid", "metadata.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as Record<string, unknown>;
    writeFileSync(metadataPath, JSON.stringify({ ...metadata, managed_by: "human" }, null, 2), "utf8");

    const result = generateSkillDrafts(scan, {
      repoRoot,
      generatedAt: "2026-01-02T00:00:00Z",
      commitsAnalyzed: 2,
      candidates: []
    });

    assert.equal(result.archivedSkillCount, 0);
    assert.equal(existsSync(join(repoRoot, ".compactor", "skills", "build-project-grid", "SKILL.md")), true);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("renders pattern candidate fallback markdown", () => {
  const markdown = renderPatternMarkdown({
    ...sampleCandidate(),
    outputType: "pattern",
    promotion_level: "pattern_candidate",
    promotionReasons: ["No single dominant primary area was found."]
  });

  assert.match(markdown, /# Pattern Candidate:/);
  assert.match(markdown, /This is not a skill/);
  assert.match(markdown, /No single dominant primary area/);
  assert.doesNotMatch(markdown.split("\n")[0] ?? "", /Add or Update|Feature|Skill/);
});

function sampleCandidate(overrides: Partial<CandidateSkill> = {}): CandidateSkill {
  const candidate: CandidateSkill = {
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
        hash: "abc123456789",
        shortHash: "abc1234",
        message: "Add orders grid",
        changedFiles: ["src/app/orders/orders-grid.component.ts"],
        diffSignals: ["class_added:OrdersGridComponent (src/app/orders/orders-grid.component.ts)"],
        pathSignals: ["ui_changed", "component_changed"]
      }
    ],
    commonFiles: ["src/app/orders/orders-grid.component.ts"],
    commonDirectories: ["src/app/orders"],
    observedConventions: ["Grid-related changes most often appear under `src/app/orders`."],
    observedChanges: ["Observed class_added:OrdersGridComponent (src/app/orders/orders-grid.component.ts)."],
    suggestedValidationCommands: ["npm test"],
    genericSignals: ["ui_changed", "component_changed"],
    repeatedTerms: ["orders", "grid"],
    domainTerms: ["orders", "grid"],
    rejectedNoisyTerms: ["component", "test"],
    genericCategory: "UI Component Pattern",
    genericFallbackName: "Add or Update UI Component Feature",
    namingReasons: [
      "component and frontend/test signals repeated together",
      "domain terms used for name: orders, grid",
      "rejected noisy terms: component, test"
    ],
    frameworkHints: ["angular"],
    matchedPatterns: ["grid-table-files"],
    pathSignals: ["ui_changed", "component_changed"],
    diffSignals: ["class_added:OrdersGridComponent (src/app/orders/orders-grid.component.ts)"],
    confidenceFactors: ["1 of 2 scanned commits matched this rule."],
    falsePositiveNotes: ["Review grid path matches."],
    rationale: "Multiple commits repeat grid work."
  };
  return {
    ...candidate,
    ...overrides
  } as CandidateSkill;
}
