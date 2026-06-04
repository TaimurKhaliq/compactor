import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateReport } from "../src/report/reportGenerator.js";
import type { MiningResult, ScanResult } from "../src/types.js";

test("generates concise terminal report", () => {
  const scan: ScanResult = {
    repoRoot: "/tmp/example",
    packageScripts: ["test"],
    validationCommands: ["npm test"],
    generatedAt: "2026-01-01T00:00:00Z",
    commitsAnalyzed: 5,
    commits: [],
    repeatedPathPatterns: [{ pattern: "src/app/**", count: 4, commits: ["a", "b", "c", "d"] }]
  };
  const mining: MiningResult = {
    repoRoot: "/tmp/example",
    generatedAt: "2026-01-01T00:00:00Z",
    commitsAnalyzed: 5,
    candidates: [
      {
        id: "build-project-grid",
        name: "Build Project Grid",
        outputType: "skill",
        promotion_level: "agent_ready",
        primaryArea: "frontend",
        primaryAreaShare: 1,
        workflowQuality: 0.9,
        generatedArtifactEvidenceShare: 0,
        promotionReasons: ["Promoted to skill."],
        reviewNotes: ["Promoted because the cluster has a dominant area and actionable workflow."],
        patternConfidence: 0.75,
        namingConfidence: 0.62,
        confidence: 0.75,
        evidenceCommits: [
          { hash: "1111111", shortHash: "1111111", message: "One", changedFiles: [], diffSignals: [], pathSignals: [] },
          { hash: "2222222", shortHash: "2222222", message: "Two", changedFiles: [], diffSignals: [], pathSignals: [] }
        ],
        commonFiles: [],
        commonDirectories: ["src/app/orders"],
        observedConventions: [],
        observedChanges: [],
        suggestedValidationCommands: [],
        genericSignals: ["ui_changed"],
        repeatedTerms: ["grid"],
        domainTerms: ["grid"],
        rejectedNoisyTerms: ["component"],
        genericCategory: "Frontend Change Pattern",
        genericFallbackName: "Update Frontend Change Pattern",
        namingReasons: ["domain terms used for name: grid"],
        frameworkHints: [],
        matchedPatterns: [],
        pathSignals: [],
        diffSignals: [],
        confidenceFactors: [],
        falsePositiveNotes: [],
        rationale: "Repeated grid work."
      }
    ]
  };

  const report = generateReport(scan, mining);
  assert.match(report, /Commits analyzed: 5/);
  assert.match(report, /Agent-ready skills: 1/);
  assert.match(report, /Draft skills: 0/);
  assert.match(report, /Pattern candidates: 0/);
  assert.match(report, /Archived\/deprecated skills: 0/);
  assert.match(report, /Merged duplicate drafts: 0/);
  assert.match(report, /Suppressed duplicate drafts: 0/);
  assert.match(report, /src\/app\/\*\*: 4 commits/);
  assert.match(report, /Build Project Grid/);
});

test("uses generation archive count when provided", () => {
  const scan: ScanResult = {
    repoRoot: "/tmp/example",
    packageScripts: [],
    validationCommands: [],
    generatedAt: "2026-01-01T00:00:00Z",
    commitsAnalyzed: 0,
    commits: [],
    repeatedPathPatterns: []
  };
  const mining: MiningResult = {
    repoRoot: "/tmp/example",
    generatedAt: "2026-01-01T00:00:00Z",
    commitsAnalyzed: 0,
    candidates: []
  };

  const report = generateReport(scan, mining, { archivedSkillCount: 2 });

  assert.match(report, /Archived\/deprecated skills: 2/);
});

test("counts agent-ready, draft, and pattern tiers separately", () => {
  const scan: ScanResult = {
    repoRoot: "/tmp/example",
    packageScripts: [],
    validationCommands: [],
    generatedAt: "2026-01-01T00:00:00Z",
    commitsAnalyzed: 0,
    commits: [],
    repeatedPathPatterns: []
  };
  const agentReady = candidateFixture("agent-ready", "Agent Ready", "agent_ready");
  const draft = candidateFixture("draft", "Draft", "draft");
  const pattern = {
    ...candidateFixture("pattern", "Pattern", "pattern_candidate"),
    outputType: "pattern" as const
  };
  const mining: MiningResult = {
    repoRoot: "/tmp/example",
    generatedAt: "2026-01-01T00:00:00Z",
    commitsAnalyzed: 0,
    candidates: [agentReady, draft, pattern]
  };

  const report = generateReport(scan, mining, { archivedSkillCount: 4 });

  assert.match(report, /Agent-ready skills: 1/);
  assert.match(report, /Draft skills: 1/);
  assert.match(report, /Pattern candidates: 1/);
  assert.match(report, /Archived\/deprecated skills: 4/);
});

test("reports duplicate draft handling counts", () => {
  const scan: ScanResult = {
    repoRoot: "/tmp/example",
    packageScripts: [],
    validationCommands: [],
    generatedAt: "2026-01-01T00:00:00Z",
    commitsAnalyzed: 0,
    commits: [],
    repeatedPathPatterns: []
  };
  const mining: MiningResult = {
    repoRoot: "/tmp/example",
    generatedAt: "2026-01-01T00:00:00Z",
    commitsAnalyzed: 0,
    candidates: [],
    duplicateHandling: {
      mergedDuplicateDrafts: 2,
      suppressedDuplicateDrafts: 1
    }
  };

  const report = generateReport(scan, mining);

  assert.match(report, /Merged duplicate drafts: 2/);
  assert.match(report, /Suppressed duplicate drafts: 1/);
});

test("ignores __MACOSX archive directories in fallback archive count", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-report-"));

  try {
    mkdirSync(join(repoRoot, ".compactor", "archive", "skills", "__MACOSX"), { recursive: true });
    mkdirSync(join(repoRoot, ".compactor", "archive", "skills", "old-generated-skill"), { recursive: true });
    const scan: ScanResult = {
      repoRoot,
      packageScripts: [],
      validationCommands: [],
      generatedAt: "2026-01-01T00:00:00Z",
      commitsAnalyzed: 0,
      commits: [],
      repeatedPathPatterns: []
    };
    const mining: MiningResult = {
      repoRoot,
      generatedAt: "2026-01-01T00:00:00Z",
      commitsAnalyzed: 0,
      candidates: []
    };

    const report = generateReport(scan, mining);

    assert.match(report, /Archived\/deprecated skills: 1/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

function candidateFixture(
  id: string,
  name: string,
  promotionLevel: "agent_ready" | "draft" | "pattern_candidate"
): MiningResult["candidates"][number] {
  return {
    id,
    name,
    outputType: promotionLevel === "pattern_candidate" ? "pattern" : "skill",
    promotion_level: promotionLevel,
    primaryArea: "frontend",
    primaryAreaShare: 1,
    workflowQuality: 0.9,
    generatedArtifactEvidenceShare: 0,
    promotionReasons: [],
    reviewNotes: [],
    patternConfidence: 0.9,
    namingConfidence: 0.9,
    confidence: 0.9,
    evidenceCommits: [],
    commonFiles: [],
    commonDirectories: [],
    observedConventions: [],
    observedChanges: [],
    suggestedValidationCommands: [],
    genericSignals: ["ui_changed"],
    repeatedTerms: [],
    domainTerms: [],
    rejectedNoisyTerms: [],
    genericCategory: "Frontend Change Pattern",
    genericFallbackName: "Update Frontend Change Pattern",
    namingReasons: [],
    frameworkHints: [],
    matchedPatterns: [],
    pathSignals: [],
    diffSignals: [],
    confidenceFactors: [],
    falsePositiveNotes: [],
    rationale: ""
  };
}
