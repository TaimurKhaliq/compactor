import assert from "node:assert/strict";
import test from "node:test";
import { classifyCommit, collectRepeatedPathPatterns } from "../src/analysis/classifier.js";
import { minePatterns } from "../src/analysis/patternMiner.js";
import type { ScanResult } from "../src/types.js";

test("mines deterministic candidate skills from repeated commit evidence", () => {
  const commits = [
    classifyCommit({
      hash: "1111111111111111",
      date: "2026-01-01T00:00:00Z",
      message: "Add orders grid",
      changedFiles: [
        "src/app/orders/orders-grid.component.ts",
        "src/app/orders/orders-grid.component.html",
        "src/app/orders/orders.service.ts",
        "src/app/orders/orders-grid.component.spec.ts"
      ]
    }),
    classifyCommit({
      hash: "2222222222222222",
      date: "2026-01-02T00:00:00Z",
      message: "Add invoices table",
      changedFiles: [
        "src/app/invoices/invoices-table.component.ts",
        "src/app/invoices/invoices-table.component.scss",
        "src/app/invoices/invoices.service.ts",
        "e2e/invoices-table.spec.ts"
      ]
    }),
    classifyCommit({
      hash: "3333333333333333",
      date: "2026-01-03T00:00:00Z",
      message: "Update staging config",
      changedFiles: ["src/environments/environment.staging.ts", "angular.json"]
    }),
    classifyCommit({
      hash: "4444444444444444",
      date: "2026-01-04T00:00:00Z",
      message: "Update api config",
      changedFiles: ["config/runtime.json", "package.json"]
    })
  ];

  const scan: ScanResult = {
    repoRoot: "/tmp/example",
    generatedAt: "2026-01-05T00:00:00Z",
    commitsAnalyzed: commits.length,
    commits,
    repeatedPathPatterns: collectRepeatedPathPatterns(commits)
  };

  const result = minePatterns(scan);
  const names = result.candidates.map((candidate) => candidate.name);

  assert.ok(names.includes("Build Project Grid"));
  assert.ok(names.includes("Add or Update Tests"));
  assert.ok(names.includes("Update Runtime Configuration"));
  assert.ok(names.includes("Add Angular Feature"));

  const grid = result.candidates.find((candidate) => candidate.name === "Build Project Grid");
  assert.ok(grid);
  assert.equal(grid.evidenceCommits.length, 2);
  assert.ok(grid.confidence > 0.5);
});
