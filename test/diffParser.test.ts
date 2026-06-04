import assert from "node:assert/strict";
import test from "node:test";
import { extractTestNames, parseUnifiedDiff } from "../src/git/diffParser.js";

test("parses structured metadata from unified diffs", () => {
  const diff = [
    "diff --git a/src/cli/index.ts b/src/cli/index.ts",
    "index 1111111..2222222 100644",
    "--- a/src/cli/index.ts",
    "+++ b/src/cli/index.ts",
    "@@ -1,3 +1,8 @@",
    " export function main() {}",
    "+export function runAnalyze() {}",
    "+program.command('analyze')",
    "+program.option('--repo <url>')",
    "diff --git a/tests/cli.test.ts b/tests/cli.test.ts",
    "index 1111111..2222222 100644",
    "--- a/tests/cli.test.ts",
    "+++ b/tests/cli.test.ts",
    "@@ -1,3 +1,5 @@",
    "+describe('analyze command', () => {})",
    "+test(\"prints report\", () => {})",
    "diff --git a/package.json b/package.json",
    "index 1111111..2222222 100644",
    "--- a/package.json",
    "+++ b/package.json",
    "@@ -2,6 +2,7 @@",
    "   \"scripts\": {",
    "+    \"typecheck\": \"tsc --noEmit\",",
    "     \"test\": \"vitest\"",
    "   }",
    "diff --git a/config/runtime.json b/config/runtime.json",
    "index 1111111..2222222 100644",
    "--- a/config/runtime.json",
    "+++ b/config/runtime.json",
    "@@ -1,3 +1,4 @@",
    "+  \"apiBaseUrl\": \"http://localhost:3000\",",
    "diff --git a/server/uiServer.ts b/server/uiServer.ts",
    "index 1111111..2222222 100644",
    "--- a/server/uiServer.ts",
    "+++ b/server/uiServer.ts",
    "@@ -1,3 +1,4 @@",
    "+app.get('/api/runs', async (_req, res) => res.json([]));",
    "+export class RunsController {}"
  ].join("\n");

  const summary = parseUnifiedDiff(diff);

  assert.equal(summary.files.length, 5);
  assert.ok(summary.signals.some((signal) => signal.type === "exported_symbol_added" && signal.value === "function runAnalyze"));
  assert.ok(summary.signals.some((signal) => signal.type === "function_added" && signal.value === "runAnalyze"));
  assert.ok(summary.signals.some((signal) => signal.type === "cli_command_changed" && signal.value === "analyze"));
  assert.ok(summary.signals.some((signal) => signal.type === "cli_command_changed" && signal.value === "--repo"));
  assert.ok(summary.signals.some((signal) => signal.type === "test_case_added" && signal.value === "analyze command"));
  assert.ok(summary.signals.some((signal) => signal.type === "package_script_changed" && signal.value === "typecheck"));
  assert.ok(summary.signals.some((signal) => signal.type === "config_changed" && signal.value === "apiBaseUrl"));
  assert.ok(summary.signals.some((signal) => signal.type === "api_route_changed" && signal.value === "GET /api/runs"));
  assert.ok(summary.signals.some((signal) => signal.type === "controller_changed" && signal.value === "handler RunsController"));
});

test("extracts describe, it, and test names from added lines", () => {
  const names = extractTestNames([
    "describe('scan command', () => {})",
    "it.only(\"reads diffs\", () => {})",
    "test(`keeps summaries small`, () => {})"
  ]);

  assert.deepEqual(names, ["keeps summaries small", "reads diffs", "scan command"]);
});
