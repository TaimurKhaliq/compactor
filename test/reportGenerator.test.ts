import assert from "node:assert/strict";
import test from "node:test";
import { generateReport } from "../src/report/reportGenerator.js";
import type { MiningResult, ScanResult } from "../src/types.js";

test("generates concise terminal report", () => {
  const scan: ScanResult = {
    repoRoot: "/tmp/example",
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
        confidence: 0.75,
        evidenceCommits: [
          { hash: "1111111", shortHash: "1111111", message: "One", changedFiles: [] },
          { hash: "2222222", shortHash: "2222222", message: "Two", changedFiles: [] }
        ],
        commonFiles: [],
        commonDirectories: ["src/app/orders"],
        observedConventions: [],
        suggestedValidationCommands: [],
        matchedPatterns: [],
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
