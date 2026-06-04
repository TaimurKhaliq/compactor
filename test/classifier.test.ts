import assert from "node:assert/strict";
import test from "node:test";
import { classifyCommit, collectRepeatedPathPatterns } from "../src/analysis/classifier.js";
import { emptyDiffSummary } from "./helpers.js";

test("classifies commit metadata and path patterns", () => {
  const commit = classifyCommit({
    hash: "abcdef1234567890",
    date: "2026-01-01T00:00:00Z",
    message: "Add order grid",
    diffSummary: emptyDiffSummary(),
    changedFiles: [
      "src/app/orders/order-grid.component.ts",
      "src/app/orders/order-grid.component.html",
      "src/app/orders/order-grid.service.ts",
      "src/app/orders/order-grid.component.spec.ts"
    ]
  });

  assert.equal(commit.shortHash, "abcdef1");
  assert.equal(commit.likelyArea, "frontend");
  assert.deepEqual(commit.fileExtensions, [".html", ".ts"]);
  assert.ok(commit.repeatedPathPatterns.includes("grid-table-files"));
  assert.ok(commit.repeatedPathPatterns.includes("angular-component-files"));
  assert.ok(commit.repeatedPathPatterns.includes("service-files"));
  assert.ok(commit.repeatedPathPatterns.includes("unit-test-files"));
});

test("collects repeated path patterns across commits", () => {
  const commits = [
    classifyCommit({
      hash: "1111111111111111",
      date: "2026-01-01T00:00:00Z",
      message: "Grid one",
      diffSummary: emptyDiffSummary(),
      changedFiles: ["src/app/a/a-grid.component.ts"]
    }),
    classifyCommit({
      hash: "2222222222222222",
      date: "2026-01-02T00:00:00Z",
      message: "Grid two",
      diffSummary: emptyDiffSummary(),
      changedFiles: ["src/app/b/b-grid.component.ts"]
    })
  ];

  const patterns = collectRepeatedPathPatterns(commits);
  assert.equal(patterns.find((pattern) => pattern.pattern === "grid-table-files")?.count, 2);
});
