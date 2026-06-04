import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateSkillDrafts, renderSkillMarkdown } from "../src/skills/skillGenerator.js";
import type { CandidateSkill, MiningResult, ScanResult } from "../src/types.js";

test("renders practical skill markdown", () => {
  const markdown = renderSkillMarkdown(sampleCandidate());

  assert.match(markdown, /^# Build Project Grid/m);
  assert.match(markdown, /Pattern confidence: 82%/);
  assert.match(markdown, /Naming confidence: 74%/);
  assert.match(markdown, /## When to use/);
  assert.match(markdown, /## Nearest examples/);
  assert.match(markdown, /## Observed changes/);
  assert.match(markdown, /## Why Compactor proposed this/);
  assert.match(markdown, /## Evidence/);
  assert.match(markdown, /abc1234/);
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

    const skill = readFileSync(join(repoRoot, ".compactor", "skills", "build-project-grid", "SKILL.md"), "utf8");
    const agents = readFileSync(join(repoRoot, ".compactor", "AGENTS.md"), "utf8");

    assert.match(skill, /# Build Project Grid/);
    assert.match(agents, /Compactor Draft Repo Guidance/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

function sampleCandidate(): CandidateSkill {
  return {
    id: "build-project-grid",
    name: "Build Project Grid",
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
    frameworkHints: ["angular"],
    matchedPatterns: ["grid-table-files"],
    pathSignals: ["ui_changed", "component_changed"],
    diffSignals: ["class_added:OrdersGridComponent (src/app/orders/orders-grid.component.ts)"],
    confidenceFactors: ["1 of 2 scanned commits matched this rule."],
    falsePositiveNotes: ["Review grid path matches."],
    rationale: "Multiple commits repeat grid work."
  };
}
