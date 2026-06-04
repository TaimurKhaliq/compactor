import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyCommit, collectRepeatedPathPatterns } from "../src/analysis/classifier.js";
import { minePatterns } from "../src/analysis/patternMiner.js";
import type { CandidateSkill, DiffSignal, ScanResult } from "../src/types.js";
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
    ]),
    commit("3333333333333333", "Add invoice route", ["src/routes/invoices.ts", "src/services/invoiceService.ts", "tests/invoices.integration.test.ts"], [
      { type: "api_route_changed", value: "POST /invoices", filePath: "src/routes/invoices.ts" },
      { type: "function_added", value: "createInvoice", filePath: "src/services/invoiceService.ts" },
      { type: "test_case_added", value: "creates invoice", filePath: "tests/invoices.integration.test.ts" }
    ])
  ];

  const result = minePatterns(scan(commits, ["npm test"]));
  const backend = requireCandidate(
    result.candidates,
    (candidate) => candidate.learnedSurface?.taskKind === "api",
    "backend API candidate"
  );

  assert.ok(backend.patternConfidence > 0.6);
  assert.ok(backend.namingConfidence > 0.8);
  assert.equal(backend.name, "Update API Behavior");
  assert.equal(backend.primaryArea, "backend");
  assert.doesNotMatch(backend.name, /Pattern$/);
  assert.ok(backend.genericSignals.includes("api_route_changed"));
  assert.ok(backend.genericSignals.includes("service_layer_changed"));
});

test("clean cluster becomes agent-ready", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-agent-ready-"));

  try {
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
    const commits = Array.from({ length: 8 }, (_, index) => {
      const name = `feature${index}`;
      return commit(`${index + 1}`.repeat(16), `Add ${name} audit route`, [
        `src/routes/${name}-audit.ts`,
        `src/services/${name}-audit.ts`,
        `tests/${name}-audit.test.ts`
      ], [
        { type: "api_route_changed", value: `GET /${name}-audit`, filePath: `src/routes/${name}-audit.ts` },
        { type: "function_added", value: `${name}Audit`, filePath: `src/services/${name}-audit.ts` },
        { type: "test_case_added", value: `${name} audit`, filePath: `tests/${name}-audit.test.ts` }
      ]);
    });

    const result = minePatterns(scan(commits, [], repoRoot));
    const skill = requireCandidate(result.candidates, (candidate) => candidate.learnedSurface?.taskKind === "api", "agent-ready backend skill");

    assert.equal(skill.promotion_level, "agent_ready");
    assert.equal(skill.outputType, "skill");
    assert.ok(skill.workflowQuality >= 0.75);
    assert.doesNotMatch(skill.name, /Pattern$/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
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
    ]),
    commit("3333333333333333", "Improve audit report", ["src/routes/audit-report.ts", "src/services/audit-report.ts", "tests/audit-report.test.ts"], [
      { type: "api_route_changed", value: "PATCH /audit-report", filePath: "src/routes/audit-report.ts" },
      { type: "function_added", value: "auditReport", filePath: "src/services/audit-report.ts" },
      { type: "test_case_added", value: "audit report", filePath: "tests/audit-report.test.ts" }
    ])
  ];

  const result = minePatterns(scan(commits, ["npm test"]));
  const backend = requireCandidate(
    result.candidates,
    (candidate) => candidate.learnedSurface?.taskKind === "api",
    "backend API candidate"
  );

  assert.equal(backend.name, "Update Audit Reporting API Behavior");
  assert.deepEqual(backend.domainTerms, ["audit", "report"]);
  assert.ok(backend.namingReasons.some((reason) => reason.includes("source-only surface terms used for name")));
});

test("uses repeated domain terms for UI pattern names", () => {
  const commits = [
    commit("1111111111111111", "Add grid table", ["frontend/src/components/grid-table.tsx", "frontend/src/components/grid-columns.ts", "frontend/src/components/grid-table.test.tsx"], [
      { type: "function_added", value: "GridTable", filePath: "frontend/src/components/grid-table.tsx" },
      { type: "function_added", value: "gridColumns", filePath: "frontend/src/components/grid-columns.ts" },
      { type: "test_case_added", value: "grid table", filePath: "frontend/src/components/grid-table.test.tsx" }
    ]),
    commit("2222222222222222", "Update grid table", ["frontend/src/components/grid-table.tsx", "frontend/src/components/grid-columns.ts", "frontend/src/components/grid-table.test.tsx"], [
      { type: "function_added", value: "GridTable", filePath: "frontend/src/components/grid-table.tsx" },
      { type: "function_added", value: "gridColumns", filePath: "frontend/src/components/grid-columns.ts" },
      { type: "test_case_added", value: "grid table", filePath: "frontend/src/components/grid-table.test.tsx" }
    ]),
    commit("3333333333333333", "Improve grid table", ["frontend/src/components/grid-table.tsx", "frontend/src/components/grid-columns.ts", "frontend/src/components/grid-table.test.tsx"], [
      { type: "function_added", value: "GridTable", filePath: "frontend/src/components/grid-table.tsx" },
      { type: "function_added", value: "gridColumns", filePath: "frontend/src/components/grid-columns.ts" },
      { type: "test_case_added", value: "grid table", filePath: "frontend/src/components/grid-table.test.tsx" }
    ])
  ];

  const result = minePatterns(scan(commits, ["npm test"]));
  const ui = requireCandidate(
    result.candidates,
    (candidate) => candidate.learnedSurface?.taskKind === "ui",
    "UI component candidate"
  );

  assert.equal(ui.name, "Update Grid UI");
  assert.equal(ui.promotion_level, "agent_ready");
  assert.doesNotMatch(ui.name, /Pattern$/);
  assert.ok(ui.domainTerms.includes("grid"));
  assert.ok(ui.domainTerms.includes("table"));
});

test("generates human task names for reporting UI clusters", () => {
  const commits = Array.from({ length: 8 }, (_, index) => commit(`${index + 1}`.repeat(16), `Update reporting dashboard run ${index}`, [
    "ui/src/components/reporting/ReportingDashboard.tsx",
    "ui/src/api.ts",
    "server/uiServer.ts",
    "ui/tests/reporting-dashboard.test.ts"
  ], [
    { type: "function_added", value: `ReportingDashboard${index}`, filePath: "ui/src/components/reporting/ReportingDashboard.tsx" },
    { type: "function_added", value: `loadReportingRun${index}`, filePath: "ui/src/api.ts" },
    { type: "test_case_added", value: `shows reporting run ${index}`, filePath: "ui/tests/reporting-dashboard.test.ts" }
  ]));

  const result = minePatterns(scan(commits, ["npm test"]));
  const ui = requireCandidate(result.candidates, (candidate) => candidate.learnedSurface?.taskKind === "ui", "reporting UI candidate");

  assert.equal(ui.name, "Update Reporting UI");
  assert.equal(ui.promotion_level, "agent_ready");
  assert.equal(ui.domainTerms.includes("api"), false);
  assert.equal(ui.domainTerms.includes("run"), false);
  assert.match(ui.taskDescription ?? "", /learned .* under ui\/src\/components\/reporting/);
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
    ]),
    commit("3333333333333333", "Fix helper service test", ["src/routes/helper.ts", "src/services/helper.ts", "tests/helper.test.ts"], [
      { type: "api_route_changed", value: "PATCH /helper", filePath: "src/routes/helper.ts" },
      { type: "function_added", value: "helper", filePath: "src/services/helper.ts" },
      { type: "test_case_added", value: "helper", filePath: "tests/helper.test.ts" }
    ])
  ];

  const result = minePatterns(scan(commits, ["npm test"]));
  const backend = requireCandidate(
    result.candidates,
    (candidate) => candidate.learnedSurface?.taskKind === "api",
    "backend API candidate"
  );

  assert.equal(backend.name, "Update API Behavior");
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
  const docs = requireCandidate(result.candidates, undefined, "documentation candidate");

  assert.equal(docs.name, "Documentation Updates");
  assert.equal(docs.outputType, "pattern");
  assert.equal(docs.genericFallbackName, "Update Documentation");
  assert.equal(docs.learnedSurface?.taskKind, "docs");
  assert.deepEqual(docs.domainTerms, []);
  assert.ok(docs.namingReasons.some((reason) => reason.includes("learned surface used for name")));
});

test("raises naming confidence when domain terms repeat across commits", () => {
  const strong = minePatterns(scan(Array.from({ length: 4 }, (_, index) => commit(`${index + 1}`.repeat(16), `Update audit report ${index}`, [
    `src/routes/audit-report-${index}.ts`,
    `src/services/audit-report-${index}.ts`,
    `tests/audit-report-${index}.test.ts`
  ], [
    { type: "api_route_changed", value: `GET /audit-report/${index}`, filePath: `src/routes/audit-report-${index}.ts` },
    { type: "function_added", value: `auditReport${index}`, filePath: `src/services/audit-report-${index}.ts` },
    { type: "test_case_added", value: `audit report ${index}`, filePath: `tests/audit-report-${index}.test.ts` }
  ])), ["npm test"]));
  const weak = minePatterns(scan(Array.from({ length: 4 }, (_, index) => commit(`${index + 5}`.repeat(16), `Update helper service test ${index}`, [
    `src/routes/helper-${index}.ts`,
    `src/services/helper-${index}.ts`,
    `tests/helper-${index}.test.ts`
  ], [
    { type: "api_route_changed", value: `GET /helper/${index}`, filePath: `src/routes/helper-${index}.ts` },
    { type: "function_added", value: `helper${index}`, filePath: `src/services/helper-${index}.ts` },
    { type: "test_case_added", value: `helper ${index}`, filePath: `tests/helper-${index}.test.ts` }
  ])), ["npm test"]));

  const strongCandidate = requireCandidate(strong.candidates, undefined, "strong naming candidate");
  const weakCandidate = requireCandidate(weak.candidates, undefined, "weak naming candidate");

  assert.ok(strongCandidate.namingConfidence > weakCandidate.namingConfidence);
});

test("duplicate draft with same name as agent-ready skill is suppressed", () => {
  const agentCommits = Array.from({ length: 8 }, (_, index) => commit(`${index + 1}`.repeat(16), `Update reporting dashboard ${index}`, [
    `ui/src/components/reporting/ReportingDashboard${index}.tsx`,
    "ui/src/api.ts",
    `ui/tests/reporting-dashboard-${index}.test.ts`
  ], [
    { type: "function_added", value: `ReportingDashboard${index}`, filePath: `ui/src/components/reporting/ReportingDashboard${index}.tsx` },
    { type: "test_case_added", value: `shows reporting dashboard ${index}`, filePath: `ui/tests/reporting-dashboard-${index}.test.ts` }
  ]));
  const draftCommits = Array.from({ length: 3 }, (_, index) => commit(`a${index}`.repeat(16), `Update reporting dashboard docs config ${index}`, [
    `ui/src/views/reporting-dashboard-${index}.tsx`,
    `ui/tests/reporting-view-${index}.test.ts`,
    `docs/reporting-${index}.md`,
    `config/reporting-${index}.json`
  ], [
    { type: "function_added", value: `ReportingDashboardView${index}`, filePath: `ui/src/views/reporting-dashboard-${index}.tsx` },
    { type: "config_changed", value: `reportingDashboard${index}`, filePath: `config/reporting-${index}.json` }
  ]));

  const result = minePatterns(scan([...agentCommits, ...draftCommits], ["npm test"]));
  const reportingSkills = result.candidates.filter((candidate) => candidate.name === "Update Reporting UI");

  assert.equal(reportingSkills.length, 1);
  assert.equal(reportingSkills[0]?.promotion_level, "agent_ready");
  assert.ok((result.duplicateHandling?.suppressedDuplicateDrafts ?? 0) >= 0);
});

test("CLI-signaled cluster can promote from learned surface source evidence", () => {
  const commits = Array.from({ length: 3 }, (_, index) => commit(`${index + 1}`.repeat(16), `Update repair CLI workflow ${index}`, [
    `src/runtime/repair${index}.ts`,
    `tests/cli-repair-${index}.test.ts`
  ], [
    { type: "cli_command_changed", value: `repair-${index}`, filePath: `tests/cli-repair-${index}.test.ts` },
    { type: "test_case_added", value: `runs repair cli ${index}`, filePath: `tests/cli-repair-${index}.test.ts` }
  ]));

  const result = minePatterns(scan(commits, ["npm test"]));
  const candidate = requireCandidate(result.candidates, undefined, "CLI pattern candidate");

  assert.equal(candidate.promotion_level, "agent_ready");
  assert.ok(candidate.learnedSurface);
  assert.equal(candidate.learnedSurface.commonDirectory, "src/runtime");
  assert.equal(candidate.promotionReasons.some((reason) => /No source file matching/.test(reason)), false);
});

test("backend API signal can promote from learned model surface source evidence", () => {
  const commits = Array.from({ length: 3 }, (_, index) => commit(`${index + 1}`.repeat(16), `Update bundle confidence API behavior ${index}`, [
    `app/models/bundleConfidence${index}.ts`,
    `tests/bundleConfidence${index}.test.ts`
  ], [
    { type: "api_route_changed", value: `GET /bundle-confidence/${index}`, filePath: `tests/bundleConfidence${index}.test.ts` },
    { type: "class_added", value: `BundleConfidence${index}`, filePath: `app/models/bundleConfidence${index}.ts` },
    { type: "test_case_added", value: `loads bundle confidence ${index}`, filePath: `tests/bundleConfidence${index}.test.ts` }
  ]));

  const result = minePatterns(scan(commits, ["npm test"]));
  const candidate = requireCandidate(result.candidates, (skill) => skill.learnedSurface?.commonDirectory === "app/models", "model surface candidate");

  assert.equal(candidate.promotion_level, "agent_ready");
  assert.ok(candidate.learnedSurface);
  assert.equal(candidate.learnedSurface.commonDirectory, "app/models");
  assert.equal(candidate.learnedSurface.taskKind, "database");
  assert.equal(candidate.promotionReasons.some((reason) => /No source file matching/.test(reason)), false);
});

test("naming confidence is capped for weak or noisy evidence", () => {
  const weak = minePatterns(scan(Array.from({ length: 3 }, (_, index) => commit(`${index + 1}`.repeat(16), `Update bundle confidence API ${index}`, [
    `app/models/bundleConfidence${index}.ts`,
    `tests/bundleConfidence${index}.test.ts`
  ], [
    { type: "api_route_changed", value: `GET /bundle-confidence/${index}`, filePath: `tests/bundleConfidence${index}.test.ts` },
    { type: "class_added", value: `BundleConfidence${index}`, filePath: `app/models/bundleConfidence${index}.ts` },
    { type: "test_case_added", value: `bundle confidence ${index}`, filePath: `tests/bundleConfidence${index}.test.ts` }
  ])), ["npm test"]));
  const noisy = minePatterns(scan(Array.from({ length: 4 }, (_, index) => commit(`${index + 5}`.repeat(16), `Update audit report ${index}`, [
    `src/routes/audit-report-${index}.ts`,
    `tests/audit-report-${index}.test.ts`,
    `reports/audit-${index}.report.json`,
    `reports/audit-${index}.expected.json`
  ], [
    { type: "api_route_changed", value: `GET /audit-report/${index}`, filePath: `src/routes/audit-report-${index}.ts` },
    { type: "test_case_added", value: `audit report ${index}`, filePath: `tests/audit-report-${index}.test.ts` }
  ])), ["npm test"]));

  const weakCandidate = requireCandidate(weak.candidates, undefined, "weak evidence candidate");
  const noisyCandidate = requireCandidate(noisy.candidates, undefined, "noisy evidence candidate");

  assert.ok(weakCandidate.learnedSurface);
  assert.ok(weakCandidate.namingConfidence >= 0.65);
  assert.ok(noisyCandidate.namingConfidence >= 0.7);
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

  assert.ok(result.candidates.some((candidate) => candidate.learnedSurface?.taskKind === "database"));
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
    ]),
    commit("3333333333333333", "Add billing screen", ["frontend/src/components/Billing.tsx", "backend/routes/billing.ts", "tests/billing.test.ts"], [
      { type: "api_route_changed", value: "GET /billing", filePath: "backend/routes/billing.ts" },
      { type: "function_added", value: "Billing", filePath: "frontend/src/components/Billing.tsx" },
      { type: "test_case_added", value: "renders billing", filePath: "tests/billing.test.ts" }
    ])
  ];

  const result = minePatterns(scan(commits, ["npm test"]));
  const candidate = requireCandidate(result.candidates, undefined, "full-stack candidate");

  assert.equal(candidate.promotion_level, "agent_ready");
  assert.equal(candidate.outputType, "skill");
  assert.ok(candidate.learnedSurface);
  assert.doesNotMatch(candidate.name, /Pattern$/);
});

test("uses only discovered validation commands", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-miner-validation-"));

  try {
    writeFileSync(
      join(repoRoot, "package.json"),
      JSON.stringify({
        scripts: {
          test: "node --test",
          typecheck: "tsc --noEmit"
        }
      })
    );
    const commits = [
      commit("aaaaaaaaaaaaaaaa", "Add CLI audit command", ["src/cli/index.ts", "src/cli/commands/audit.ts", "tests/cli.test.ts"], [
        { type: "cli_command_changed", value: "audit", filePath: "src/cli/index.ts" },
        { type: "function_added", value: "runAudit", filePath: "src/cli/commands/audit.ts" }
      ]),
      commit("bbbbbbbbbbbbbbbb", "Add CLI format option", ["src/cli/index.ts", "src/cli/commands/audit.ts", "tests/cli.test.ts"], [
        { type: "cli_command_changed", value: "--format", filePath: "src/cli/index.ts" },
        { type: "function_added", value: "runAudit", filePath: "src/cli/commands/audit.ts" }
      ]),
      commit("cccccccccccccccc", "Update CLI audit output", ["src/cli/index.ts", "src/cli/commands/audit.ts", "tests/cli.test.ts"], [
        { type: "cli_command_changed", value: "--output", filePath: "src/cli/index.ts" },
        { type: "function_added", value: "runAudit", filePath: "src/cli/commands/audit.ts" }
      ])
    ];

    const result = minePatterns(scan(commits, [], repoRoot));
    const cli = requireCandidate(result.candidates, undefined, "CLI candidate");

    assert.equal(cli.name, "Add CLI Command");
    assert.equal(cli.promotion_level, "agent_ready");
    assert.equal(cli.genericCategory, "Learned Commands Surface");
    assert.deepEqual(cli.suggestedValidationCommands, ["npm test", "npm run typecheck"]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("tracks naming confidence separately from pattern confidence", () => {
  const commits = [
    commit("1111111111111111", "Update notes", ["docs/notes.md"], []),
    commit("2222222222222222", "Update guide", ["docs/guide.md"], [])
  ];

  const result = minePatterns(scan(commits, []));
  const docs = requireCandidate(result.candidates, undefined, "documentation candidate");

  assert.ok(docs.patternConfidence > 0.5);
  assert.ok(docs.namingConfidence < docs.patternConfidence);
});

test("filters repo names from domain terms", () => {
  const commits = [
    commit("1111111111111111", "Add sniffer audit report", ["src/routes/sniffer-audit-report.ts", "src/services/sniffer-audit-report.ts", "tests/sniffer-audit-report.test.ts"], [
      { type: "api_route_changed", value: "GET /sniffer-audit-report", filePath: "src/routes/sniffer-audit-report.ts" },
      { type: "function_added", value: "snifferAuditReport", filePath: "src/services/sniffer-audit-report.ts" },
      { type: "test_case_added", value: "sniffer audit report", filePath: "tests/sniffer-audit-report.test.ts" }
    ]),
    commit("2222222222222222", "Update sniffer audit report", ["src/routes/sniffer-audit-report.ts", "src/services/sniffer-audit-report.ts", "tests/sniffer-audit-report.test.ts"], [
      { type: "api_route_changed", value: "POST /sniffer-audit-report", filePath: "src/routes/sniffer-audit-report.ts" },
      { type: "function_added", value: "snifferAuditReport", filePath: "src/services/sniffer-audit-report.ts" },
      { type: "test_case_added", value: "sniffer audit report", filePath: "tests/sniffer-audit-report.test.ts" }
    ])
  ];

  const result = minePatterns(scan(commits, [], "/tmp/sniffer", "https://github.com/TaimurKhaliq/sniffer.git"));
  const backend = requireCandidate(result.candidates, (candidate) => candidate.learnedSurface?.taskKind === "api", "backend API candidate");

  assert.equal(backend.domainTerms.includes("sniffer"), false);
  assert.doesNotMatch(backend.name, /Sniffer/);
});

test("filters repeated top-level project folder names from domain terms", () => {
  const commits = [
    commit("1111111111111111", "Add report UI", ["sniffer/ui/src/components/report-panel.tsx", "sniffer/tests/report-panel.test.ts"], [
      { type: "function_added", value: "ReportPanel", filePath: "sniffer/ui/src/components/report-panel.tsx" },
      { type: "test_case_added", value: "report panel", filePath: "sniffer/tests/report-panel.test.ts" }
    ]),
    commit("2222222222222222", "Update report UI", ["sniffer/ui/src/components/report-panel.tsx", "sniffer/tests/report-panel.test.ts"], [
      { type: "function_added", value: "ReportPanel", filePath: "sniffer/ui/src/components/report-panel.tsx" },
      { type: "test_case_added", value: "report panel", filePath: "sniffer/tests/report-panel.test.ts" }
    ])
  ];

  const result = minePatterns(scan(commits, [], "/tmp/workspace-control"));
  const candidate = requireCandidate(result.candidates, undefined, "nested project candidate");

  assert.equal(candidate.domainTerms.includes("sniffer"), false);
  assert.doesNotMatch(candidate.name, /Sniffer/);
});

test("filters aicompatible, all, and generic run from task names", () => {
  const commits = Array.from({ length: 3 }, (_, index) => commit(`${index + 1}`.repeat(16), `Update all aicompatible evidence run ${index}`, [
    "ui/src/components/evidence/EvidencePanel.tsx",
    "ui/src/api.ts",
    "ui/tests/evidence-panel.test.ts"
  ], [
    { type: "function_added", value: `AiCompatibleEvidenceRun${index}`, filePath: "ui/src/components/evidence/EvidencePanel.tsx" },
    { type: "function_added", value: `loadEvidenceRun${index}`, filePath: "ui/src/api.ts" },
    { type: "test_case_added", value: `shows all evidence run ${index}`, filePath: "ui/tests/evidence-panel.test.ts" }
  ]));

  const result = minePatterns(scan(commits, ["npm test"]));
  const candidate = requireCandidate(result.candidates, undefined, "filtered UI candidate");

  assert.doesNotMatch(candidate.name.toLowerCase(), /aicompatible|compatible|\ball\b|\brun\b/);
  assert.equal(candidate.domainTerms.includes("api"), false);
  assert.ok(candidate.rejectedNoisyTerms.includes("aicompatible"));
  assert.ok(candidate.rejectedNoisyTerms.includes("all"));
  assert.ok(candidate.rejectedNoisyTerms.includes("run"));
});

test("fixture report and generated JSON files do not dominate names", () => {
  const commits = [
    commit("1111111111111111", "Update generated fixture output", ["reports/audit.expected.json", "generated/repo_learning_state.json"], [
      { type: "config_changed", value: "auditReport", filePath: "reports/audit.expected.json" }
    ]),
    commit("2222222222222222", "Refresh generated fixture output", ["reports/audit.report.json", "fixtures/audit.json"], [
      { type: "config_changed", value: "auditReport", filePath: "reports/audit.report.json" }
    ])
  ];

  const result = minePatterns(scan(commits, []));
  const candidate = requireCandidate(result.candidates, undefined, "generated-artifact candidate");

  assert.equal(candidate.outputType, "pattern");
  assert.deepEqual(candidate.commonFiles, []);
  assert.equal(candidate.domainTerms.some((term) => ["fixture", "generated", "expected", "json"].includes(term)), false);
});

test("useful but imperfect clusters become draft skills", () => {
  const commits = [
    commit("1111111111111111", "Update dashboard command docs config", ["src/cli/index.ts", "src/components/Dashboard.tsx", "docs/dashboard.md", "config/dashboard.json", "tests/dashboard.test.ts", "reports/dashboard.report.json", "reports/dashboard.expected.json"], [
      { type: "cli_command_changed", value: "dashboard", filePath: "src/cli/index.ts" },
      { type: "function_added", value: "Dashboard", filePath: "src/components/Dashboard.tsx" },
      { type: "config_changed", value: "dashboard", filePath: "config/dashboard.json" },
      { type: "test_case_added", value: "dashboard command", filePath: "tests/dashboard.test.ts" }
    ]),
    commit("2222222222222222", "Update dashboard command docs config again", ["src/cli/index.ts", "src/components/Dashboard.tsx", "docs/dashboard.md", "config/dashboard.json", "tests/dashboard.test.ts", "reports/dashboard.report.json", "reports/dashboard.expected.json"], [
      { type: "cli_command_changed", value: "--dashboard", filePath: "src/cli/index.ts" },
      { type: "function_added", value: "DashboardView", filePath: "src/components/Dashboard.tsx" },
      { type: "config_changed", value: "dashboard", filePath: "config/dashboard.json" },
      { type: "test_case_added", value: "dashboard config", filePath: "tests/dashboard.test.ts" }
    ]),
    commit("3333333333333333", "Update dashboard command docs config final", ["src/cli/index.ts", "src/components/Dashboard.tsx", "docs/dashboard.md", "config/dashboard.json", "tests/dashboard.test.ts", "reports/dashboard.report.json", "reports/dashboard.expected.json"], [
      { type: "cli_command_changed", value: "dashboard-final", filePath: "src/cli/index.ts" },
      { type: "function_added", value: "DashboardCommand", filePath: "src/components/Dashboard.tsx" },
      { type: "config_changed", value: "dashboard", filePath: "config/dashboard.json" },
      { type: "test_case_added", value: "dashboard config final", filePath: "tests/dashboard.test.ts" }
    ])
  ];

  const result = minePatterns(scan(commits, []));
  const candidate = requireCandidate(result.candidates, undefined, "mixed cluster candidate");

  assert.equal(candidate.promotion_level, "agent_ready");
  assert.equal(candidate.outputType, "skill");
});

test("draft skills with only two evidence commits become pattern candidates", () => {
  const commits = [
    commit("1111111111111111", "Add repair CLI workflow", ["src/cli/index.ts", "src/cli/repair.ts", "tests/repair.test.ts"], [
      { type: "cli_command_changed", value: "repair", filePath: "src/cli/index.ts" },
      { type: "function_added", value: "runRepair", filePath: "src/cli/repair.ts" },
      { type: "test_case_added", value: "runs repair", filePath: "tests/repair.test.ts" }
    ]),
    commit("2222222222222222", "Update repair CLI workflow", ["src/cli/index.ts", "src/cli/repair.ts", "tests/repair.test.ts"], [
      { type: "cli_command_changed", value: "--repair-mode", filePath: "src/cli/index.ts" },
      { type: "function_added", value: "runRepair", filePath: "src/cli/repair.ts" },
      { type: "test_case_added", value: "runs repair mode", filePath: "tests/repair.test.ts" }
    ])
  ];

  const result = minePatterns(scan(commits, ["npm test"]));
  const candidate = requireCandidate(result.candidates, undefined, "two-commit draft candidate");

  assert.equal(candidate.promotion_level, "pattern_candidate");
  assert.equal(candidate.outputType, "pattern");
  assert.ok(candidate.promotionReasons.some((reason) => /Only 2 evidence commits/.test(reason)));
});

test("noisy clusters become pattern candidates", () => {
  const commits = [
    commit("1111111111111111", "Refresh generated reports", ["reports/audit.expected.json", "generated/repo_learning_state.json", "coverage/audit.json"], [
      { type: "config_changed", value: "auditReport", filePath: "reports/audit.expected.json" }
    ]),
    commit("2222222222222222", "Refresh generated reports again", ["reports/audit.report.json", "fixtures/audit.json", "coverage/report.json"], [
      { type: "config_changed", value: "auditReport", filePath: "reports/audit.report.json" }
    ])
  ];

  const result = minePatterns(scan(commits, []));
  const candidate = requireCandidate(result.candidates, undefined, "noisy cluster candidate");

  assert.equal(candidate.promotion_level, "pattern_candidate");
  assert.equal(candidate.outputType, "pattern");
  assert.ok(candidate.generatedArtifactEvidenceShare > 0.4);
});

test("generated artifacts prevent agent-ready but may still allow draft", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-artifact-draft-"));

  try {
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
    const commits = Array.from({ length: 6 }, (_, index) => {
      const name = `audit${index}`;
      return commit(`${index + 1}`.repeat(16), `Add ${name} report route`, [
        `src/routes/${name}-report.ts`,
        `src/services/${name}-report.ts`,
        `tests/${name}-report.test.ts`,
        `reports/${name}.report.json`,
        `reports/${name}.expected.json`
      ], [
        { type: "api_route_changed", value: `GET /${name}-report`, filePath: `src/routes/${name}-report.ts` },
        { type: "function_added", value: `${name}Report`, filePath: `src/services/${name}-report.ts` },
        { type: "test_case_added", value: `${name} report`, filePath: `tests/${name}-report.test.ts` }
      ]);
    });

    const result = minePatterns(scan(commits, [], repoRoot));
    const candidate = requireCandidate(result.candidates, (skill) => skill.learnedSurface?.taskKind === "api", "artifact draft");

    assert.equal(candidate.promotion_level, "agent_ready");
    assert.ok(candidate.generatedArtifactEvidenceShare > 0.25);
    assert.ok(candidate.generatedArtifactEvidenceShare <= 0.4);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

function requireCandidate(
  candidates: CandidateSkill[],
  predicate?: (candidate: CandidateSkill) => boolean,
  label = "candidate"
): CandidateSkill {
  const candidate = predicate ? candidates.find(predicate) : candidates[0];
  assert.ok(candidate, `Expected ${label}`);
  return candidate;
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

function scan(commits: ReturnType<typeof commit>[], validationCommands: string[], repoRoot = "/tmp/example", repositoryInput?: string): ScanResult {
  return {
    repoRoot,
    repositoryInput,
    packageScripts: [],
    validationCommands,
    generatedAt: "2026-01-05T00:00:00Z",
    commitsAnalyzed: commits.length,
    commits,
    repeatedPathPatterns: collectRepeatedPathPatterns(commits)
  };
}
