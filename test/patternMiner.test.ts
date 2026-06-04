import assert from "node:assert/strict";
import test from "node:test";
import { classifyCommit, collectRepeatedPathPatterns } from "../src/analysis/classifier.js";
import { minePatterns } from "../src/analysis/patternMiner.js";
import type { ScanResult } from "../src/types.js";
import { diffSummaryWithSignals, emptyDiffSummary } from "./helpers.js";

test("mines deterministic candidate skills from repeated commit evidence", () => {
  const commits = [
    classifyCommit({
      hash: "1111111111111111",
      date: "2026-01-01T00:00:00Z",
      message: "Add orders grid",
      diffSummary: emptyDiffSummary(),
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
      diffSummary: emptyDiffSummary(),
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
      diffSummary: emptyDiffSummary(),
      changedFiles: ["src/environments/environment.staging.ts", "angular.json"]
    }),
    classifyCommit({
      hash: "4444444444444444",
      date: "2026-01-04T00:00:00Z",
      message: "Update api config",
      diffSummary: emptyDiffSummary(),
      changedFiles: ["config/runtime.json", "package.json"]
    })
  ];

  const scan: ScanResult = {
    repoRoot: "/tmp/example",
    packageScripts: ["build", "test"],
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

test("avoids API endpoint candidates when server paths lack route diff signals", () => {
  const commits = [
    classifyCommit({
      hash: "aaaaaaaaaaaaaaaa",
      date: "2026-01-01T00:00:00Z",
      message: "Refactor server internals",
      diffSummary: emptyDiffSummary(),
      changedFiles: ["server/cache.ts", "tests/cache.test.ts"]
    }),
    classifyCommit({
      hash: "bbbbbbbbbbbbbbbb",
      date: "2026-01-02T00:00:00Z",
      message: "Update server logging",
      diffSummary: emptyDiffSummary(),
      changedFiles: ["server/logger.ts", "tests/logger.test.ts"]
    })
  ];

  const result = minePatterns({
    repoRoot: "/tmp/example",
    packageScripts: ["test"],
    generatedAt: "2026-01-03T00:00:00Z",
    commitsAnalyzed: commits.length,
    commits,
    repeatedPathPatterns: collectRepeatedPathPatterns(commits)
  });

  assert.equal(result.candidates.some((candidate) => candidate.id === "add-api-endpoint"), false);
});

test("detects UI server feature candidates from uiServer plus UI evidence", () => {
  const commits = [
    classifyCommit({
      hash: "aaaaaaaaaaaaaaaa",
      date: "2026-01-01T00:00:00Z",
      message: "Add UI graph endpoint",
      diffSummary: diffSummaryWithSignals([
        { type: "api-route", value: "GET /api/graph", filePath: "server/uiServer.ts" },
        { type: "test-name", value: "renders graph", filePath: "ui/tests/App.test.tsx" }
      ]),
      changedFiles: ["server/uiServer.ts", "ui/src/App.tsx", "ui/tests/App.test.tsx"]
    }),
    classifyCommit({
      hash: "bbbbbbbbbbbbbbbb",
      date: "2026-01-02T00:00:00Z",
      message: "Add UI run details",
      diffSummary: diffSummaryWithSignals([
        { type: "api-route", value: "GET /api/runs/:id", filePath: "server/uiServer.ts" },
        { type: "test-name", value: "shows run details", filePath: "ui/tests/App.test.tsx" }
      ]),
      changedFiles: ["server/uiServer.ts", "ui/src/components/RunDetails.tsx", "ui/tests/App.test.tsx"]
    })
  ];

  const result = minePatterns({
    repoRoot: "/tmp/example",
    packageScripts: ["test", "build", "ui:test"],
    generatedAt: "2026-01-03T00:00:00Z",
    commitsAnalyzed: commits.length,
    commits,
    repeatedPathPatterns: collectRepeatedPathPatterns(commits)
  });

  assert.ok(result.candidates.some((candidate) => candidate.id === "add-or-update-ui-server-feature"));
  assert.ok(result.candidates.some((candidate) => candidate.id === "add-api-endpoint"));
});

test("uses only package scripts that exist for validation commands", () => {
  const commits = [
    classifyCommit({
      hash: "aaaaaaaaaaaaaaaa",
      date: "2026-01-01T00:00:00Z",
      message: "Add CLI command",
      diffSummary: diffSummaryWithSignals([{ type: "cli-command", value: "audit", filePath: "src/cli/index.ts" }]),
      changedFiles: ["src/cli/index.ts", "tests/cli.test.ts"]
    }),
    classifyCommit({
      hash: "bbbbbbbbbbbbbbbb",
      date: "2026-01-02T00:00:00Z",
      message: "Add CLI option",
      diffSummary: diffSummaryWithSignals([{ type: "cli-option", value: "--format", filePath: "src/cli/index.ts" }]),
      changedFiles: ["src/cli/index.ts", "tests/cli.test.ts"]
    })
  ];

  const result = minePatterns({
    repoRoot: "/tmp/example",
    packageScripts: ["test", "typecheck"],
    generatedAt: "2026-01-03T00:00:00Z",
    commitsAnalyzed: commits.length,
    commits,
    repeatedPathPatterns: collectRepeatedPathPatterns(commits)
  });

  const cli = result.candidates.find((candidate) => candidate.id === "add-or-update-cli-feature");
  assert.ok(cli);
  assert.deepEqual(cli.suggestedValidationCommands, ["npm test", "npm run typecheck"]);
});
