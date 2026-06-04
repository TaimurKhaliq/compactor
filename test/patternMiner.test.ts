import assert from "node:assert/strict";
import test from "node:test";
import { classifyCommit, collectRepeatedPathPatterns } from "../src/analysis/classifier.js";
import { minePatterns } from "../src/analysis/patternMiner.js";
import type { DiffSignal, ScanResult } from "../src/types.js";
import { diffSummaryWithSignals, emptyDiffSummary } from "./helpers.js";

test("detects backend route, service, and test clusters", () => {
  const commits = [
    commit("1111111111111111", "Add user route", ["src/routes/users.ts", "src/services/userService.ts", "tests/users.integration.test.ts"], [
      { type: "api_route_changed", value: "GET /users", filePath: "src/routes/users.ts" },
      { type: "function_added", value: "getUsers", filePath: "src/services/userService.ts" },
      { type: "test_case_added", value: "returns users", filePath: "tests/users.integration.test.ts" }
    ]),
    commit("2222222222222222", "Add order route", ["src/routes/orders.ts", "src/services/orderService.ts", "tests/orders.integration.test.ts"], [
      { type: "api_route_changed", value: "POST /orders", filePath: "src/routes/orders.ts" },
      { type: "function_added", value: "createOrder", filePath: "src/services/orderService.ts" },
      { type: "test_case_added", value: "creates order", filePath: "tests/orders.integration.test.ts" }
    ])
  ];

  const result = minePatterns(scan(commits, ["npm test"]));
  const backend = result.candidates.find((candidate) => candidate.name === "Add or Update Backend API Feature");

  assert.ok(backend);
  assert.ok(backend.patternConfidence > 0.6);
  assert.ok(backend.namingConfidence > 0.8);
  assert.ok(backend.genericSignals.includes("api_route_changed"));
  assert.ok(backend.genericSignals.includes("service_layer_changed"));
});

test("uses repeated domain terms for backend pattern names", () => {
  const commits = [
    commit("1111111111111111", "Add audit report", ["src/routes/audit-report.ts", "src/services/audit-report.ts", "tests/audit-report.test.ts"], [
      { type: "api_route_changed", value: "GET /audit-report", filePath: "src/routes/audit-report.ts" },
      { type: "function_added", value: "auditReport", filePath: "src/services/audit-report.ts" },
      { type: "test_case_added", value: "audit report", filePath: "tests/audit-report.test.ts" }
    ]),
    commit("2222222222222222", "Update audit report", ["src/routes/audit-report.ts", "src/services/audit-report.ts", "tests/audit-report.test.ts"], [
      { type: "api_route_changed", value: "POST /audit-report", filePath: "src/routes/audit-report.ts" },
      { type: "function_added", value: "auditReport", filePath: "src/services/audit-report.ts" },
      { type: "test_case_added", value: "audit report", filePath: "tests/audit-report.test.ts" }
    ])
  ];

  const result = minePatterns(scan(commits, ["npm test"]));
  const backend = result.candidates.find((candidate) => candidate.genericCategory === "Backend API Feature");

  assert.ok(backend);
  assert.equal(backend.name, "Add or Update Audit Reporting Backend API Feature");
  assert.deepEqual(backend.domainTerms, ["audit", "report"]);
  assert.ok(backend.namingReasons.some((reason) => reason.includes("domain terms used for name: audit, report")));
});

test("uses repeated domain terms for UI pattern names", () => {
  const commits = [
    commit("1111111111111111", "Add grid table", ["frontend/src/components/grid-table.tsx", "frontend/src/components/grid-table.test.tsx"], [
      { type: "function_added", value: "GridTable", filePath: "frontend/src/components/grid-table.tsx" },
      { type: "test_case_added", value: "grid table", filePath: "frontend/src/components/grid-table.test.tsx" }
    ]),
    commit("2222222222222222", "Update grid table", ["frontend/src/components/grid-table.tsx", "frontend/src/components/grid-table.test.tsx"], [
      { type: "function_added", value: "GridTable", filePath: "frontend/src/components/grid-table.tsx" },
      { type: "test_case_added", value: "grid table", filePath: "frontend/src/components/grid-table.test.tsx" }
    ])
  ];

  const result = minePatterns(scan(commits, ["npm test"]));
  const ui = result.candidates.find((candidate) => candidate.genericCategory === "UI Component Pattern");

  assert.ok(ui);
  assert.equal(ui.name, "Add or Update Grid Table UI Component Pattern");
  assert.deepEqual(ui.domainTerms, ["grid", "table"]);
});

test("filters noisy terms out of generated names", () => {
  const commits = [
    commit("1111111111111111", "Add helper service test", ["src/routes/helper.ts", "src/services/helper.ts", "tests/helper.test.ts"], [
      { type: "api_route_changed", value: "GET /helper", filePath: "src/routes/helper.ts" },
      { type: "function_added", value: "helper", filePath: "src/services/helper.ts" },
      { type: "test_case_added", value: "helper", filePath: "tests/helper.test.ts" }
    ]),
    commit("2222222222222222", "Update helper service test", ["src/routes/helper.ts", "src/services/helper.ts", "tests/helper.test.ts"], [
      { type: "api_route_changed", value: "POST /helper", filePath: "src/routes/helper.ts" },
      { type: "function_added", value: "helper", filePath: "src/services/helper.ts" },
      { type: "test_case_added", value: "helper", filePath: "tests/helper.test.ts" }
    ])
  ];

  const result = minePatterns(scan(commits, ["npm test"]));
  const backend = result.candidates.find((candidate) => candidate.genericCategory === "Backend API Feature");

  assert.ok(backend);
  assert.equal(backend.name, "Add or Update Backend API Feature");
  assert.deepEqual(backend.domainTerms, []);
  assert.ok(backend.rejectedNoisyTerms.includes("helper"));
  assert.ok(backend.rejectedNoisyTerms.includes("service"));
  assert.ok(backend.rejectedNoisyTerms.includes("test"));
});

test("falls back to generic names when domain terms are weak", () => {
  const commits = [
    commit("1111111111111111", "Update file", ["docs/file.md"], []),
    commit("2222222222222222", "Update notes", ["docs/notes.md"], [])
  ];

  const result = minePatterns(scan(commits, []));
  const docs = result.candidates[0];

  assert.ok(docs);
  assert.equal(docs.name, "Update Documentation Pattern");
  assert.equal(docs.genericFallbackName, "Update Documentation Pattern");
  assert.deepEqual(docs.domainTerms, []);
  assert.ok(docs.namingReasons.some((reason) => reason.includes("generic fallback used")));
});

test("raises naming confidence when domain terms repeat across commits", () => {
  const strong = minePatterns(scan([
    commit("1111111111111111", "Add audit report", ["src/routes/audit-report.ts", "src/services/audit-report.ts", "tests/audit-report.test.ts"], [
      { type: "api_route_changed", value: "GET /audit-report", filePath: "src/routes/audit-report.ts" },
      { type: "function_added", value: "auditReport", filePath: "src/services/audit-report.ts" },
      { type: "test_case_added", value: "audit report", filePath: "tests/audit-report.test.ts" }
    ]),
    commit("2222222222222222", "Update audit report", ["src/routes/audit-report.ts", "src/services/audit-report.ts", "tests/audit-report.test.ts"], [
      { type: "api_route_changed", value: "POST /audit-report", filePath: "src/routes/audit-report.ts" },
      { type: "function_added", value: "auditReport", filePath: "src/services/audit-report.ts" },
      { type: "test_case_added", value: "audit report", filePath: "tests/audit-report.test.ts" }
    ])
  ], ["npm test"]));
  const weak = minePatterns(scan([
    commit("aaaaaaaaaaaaaaaa", "Add helper service test", ["src/routes/helper.ts", "src/services/helper.ts", "tests/helper.test.ts"], [
      { type: "api_route_changed", value: "GET /helper", filePath: "src/routes/helper.ts" },
      { type: "function_added", value: "helper", filePath: "src/services/helper.ts" },
      { type: "test_case_added", value: "helper", filePath: "tests/helper.test.ts" }
    ]),
    commit("bbbbbbbbbbbbbbbb", "Update helper service test", ["src/routes/helper.ts", "src/services/helper.ts", "tests/helper.test.ts"], [
      { type: "api_route_changed", value: "POST /helper", filePath: "src/routes/helper.ts" },
      { type: "function_added", value: "helper", filePath: "src/services/helper.ts" },
      { type: "test_case_added", value: "helper", filePath: "tests/helper.test.ts" }
    ])
  ], ["npm test"]));

  assert.ok(strong.candidates[0]);
  assert.ok(weak.candidates[0]);
  assert.ok(strong.candidates[0].namingConfidence > weak.candidates[0].namingConfidence);
});

test("avoids false API labels when backend paths lack route diff signals", () => {
  const commits = [
    commit("aaaaaaaaaaaaaaaa", "Refactor server cache", ["server/cache.ts", "tests/cache.test.ts"], []),
    commit("bbbbbbbbbbbbbbbb", "Update server logging", ["server/logger.ts", "tests/logger.test.ts"], [])
  ];

  const result = minePatterns(scan(commits, ["npm test"]));

  assert.equal(result.candidates.some((candidate) => /API/.test(candidate.name)), false);
});

test("detects backend plus database plus test clustering", () => {
  const commits = [
    commit("1111111111111111", "Add account persistence", ["src/models/account.entity.ts", "src/repositories/accountRepository.ts", "migrations/001_accounts.sql", "tests/account.test.ts"], [
      { type: "schema_changed", value: "create table accounts", filePath: "migrations/001_accounts.sql" },
      { type: "class_added", value: "AccountEntity", filePath: "src/models/account.entity.ts" },
      { type: "test_case_added", value: "saves account", filePath: "tests/account.test.ts" }
    ]),
    commit("2222222222222222", "Add invoice persistence", ["src/models/invoice.entity.ts", "src/repositories/invoiceRepository.ts", "migrations/002_invoices.sql", "tests/invoice.test.ts"], [
      { type: "schema_changed", value: "create table invoices", filePath: "migrations/002_invoices.sql" },
      { type: "class_added", value: "InvoiceEntity", filePath: "src/models/invoice.entity.ts" },
      { type: "test_case_added", value: "saves invoice", filePath: "tests/invoice.test.ts" }
    ])
  ];

  const result = minePatterns(scan(commits, ["npm test"]));

  assert.ok(result.candidates.some((candidate) => candidate.name === "Add or Update Database-Backed Feature"));
});

test("detects full-stack feature clustering without repo-specific paths", () => {
  const commits = [
    commit("1111111111111111", "Add profile screen", ["frontend/src/components/Profile.tsx", "backend/routes/profile.ts", "tests/profile.test.ts"], [
      { type: "api_route_changed", value: "GET /profile", filePath: "backend/routes/profile.ts" },
      { type: "function_added", value: "Profile", filePath: "frontend/src/components/Profile.tsx" },
      { type: "test_case_added", value: "renders profile", filePath: "tests/profile.test.ts" }
    ]),
    commit("2222222222222222", "Add settings screen", ["frontend/src/components/Settings.tsx", "backend/routes/settings.ts", "tests/settings.test.ts"], [
      { type: "api_route_changed", value: "GET /settings", filePath: "backend/routes/settings.ts" },
      { type: "function_added", value: "Settings", filePath: "frontend/src/components/Settings.tsx" },
      { type: "test_case_added", value: "renders settings", filePath: "tests/settings.test.ts" }
    ])
  ];

  const result = minePatterns(scan(commits, ["npm test"]));

  assert.ok(result.candidates.some((candidate) => candidate.name === "Add or Update Backend API Feature" || candidate.name === "Update Full-Stack Feature Pattern"));
});

test("uses only discovered validation commands", () => {
  const commits = [
    commit("aaaaaaaaaaaaaaaa", "Add CLI audit command", ["src/cli/index.ts", "tests/cli.test.ts"], [
      { type: "cli_command_changed", value: "audit", filePath: "src/cli/index.ts" }
    ]),
    commit("bbbbbbbbbbbbbbbb", "Add CLI format option", ["src/cli/index.ts", "tests/cli.test.ts"], [
      { type: "cli_command_changed", value: "--format", filePath: "src/cli/index.ts" }
    ])
  ];

  const result = minePatterns(scan(commits, ["npm test", "npm run typecheck"]));
  assert.equal(result.candidates[0]?.name, "Add or Update CLI Feature");
  assert.equal(result.candidates[0]?.genericCategory, "CLI Feature");
  assert.deepEqual(result.candidates[0]?.suggestedValidationCommands, ["npm test", "npm run typecheck"]);
});

test("tracks naming confidence separately from pattern confidence", () => {
  const commits = [
    commit("1111111111111111", "Update notes", ["docs/notes.md"], []),
    commit("2222222222222222", "Update guide", ["docs/guide.md"], [])
  ];

  const result = minePatterns(scan(commits, []));
  const docs = result.candidates[0];

  assert.ok(docs);
  assert.ok(docs.patternConfidence > 0.5);
  assert.ok(docs.namingConfidence < docs.patternConfidence);
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

function scan(commits: ReturnType<typeof commit>[], validationCommands: string[]): ScanResult {
  return {
    repoRoot: "/tmp/example",
    packageScripts: [],
    validationCommands,
    generatedAt: "2026-01-05T00:00:00Z",
    commitsAnalyzed: commits.length,
    commits,
    repeatedPathPatterns: collectRepeatedPathPatterns(commits)
  };
}
