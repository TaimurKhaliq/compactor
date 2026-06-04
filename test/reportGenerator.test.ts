import assert from "node:assert/strict";
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
  assert.match(report, /Candidate skills found: 1/);
  assert.match(report, /src\/app\/\*\*: 4 commits/);
  assert.match(report, /Build Project Grid/);
});
