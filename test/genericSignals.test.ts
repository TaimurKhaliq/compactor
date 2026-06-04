import assert from "node:assert/strict";
import test from "node:test";
import { extractPathSignals } from "../src/analysis/genericSignals.js";
import { parseUnifiedDiff } from "../src/git/diffParser.js";

test("detects service, controller, and repository path signals", () => {
  assert.deepEqual(
    new Set(extractPathSignals("src/controllers/UserController.ts")),
    new Set(["backend_changed", "controller_changed"])
  );
  assert.ok(extractPathSignals("src/services/userService.ts").includes("service_layer_changed"));
  assert.ok(extractPathSignals("src/repositories/userRepository.ts").includes("repository_or_dao_changed"));
});

test("detects migration, model/entity, and database path signals", () => {
  assert.ok(extractPathSignals("migrations/001_create_users.sql").includes("migration_changed"));
  assert.ok(extractPathSignals("src/entities/UserEntity.java").includes("model_or_entity_changed"));
  assert.ok(extractPathSignals("prisma/schema.prisma").includes("schema_changed"));
});

test("detects CI, Docker, and config path signals", () => {
  assert.ok(extractPathSignals(".github/workflows/test.yml").includes("ci_changed"));
  assert.ok(extractPathSignals("Dockerfile").includes("docker_changed"));
  assert.ok(extractPathSignals("config/runtime.yaml").includes("config_changed"));
});

test("does not classify generated docs progress HTML as UI", () => {
  const signals = extractPathSignals("docs/progress/index.html");

  assert.equal(signals.includes("ui_changed"), false);
  assert.ok(signals.includes("docs_changed"));
});

test("detects SQL schema, index, and query changes from diffs", () => {
  const summary = parseUnifiedDiff([
    "diff --git a/db/schema.sql b/db/schema.sql",
    "--- a/db/schema.sql",
    "+++ b/db/schema.sql",
    "@@ -1,2 +1,5 @@",
    "+CREATE TABLE users (id int);",
    "+CREATE INDEX users_email_idx ON users(email);",
    "+SELECT * FROM users;"
  ].join("\n"));

  assert.ok(summary.signals.some((signal) => signal.type === "schema_changed"));
  assert.ok(summary.signals.some((signal) => signal.type === "index_changed"));
  assert.ok(summary.signals.some((signal) => signal.type === "query_changed"));
});

test("detects generic route patterns across frameworks", () => {
  const summary = parseUnifiedDiff([
    "diff --git a/api/users.py b/api/users.py",
    "--- a/api/users.py",
    "+++ b/api/users.py",
    "@@ -1,2 +1,4 @@",
    "+@app.get('/users')",
    "+def list_users(): pass",
    "diff --git a/src/UserController.java b/src/UserController.java",
    "--- a/src/UserController.java",
    "+++ b/src/UserController.java",
    "@@ -1,2 +1,4 @@",
    "+@GetMapping(\"/users\")",
    "+public List<User> listUsers() { return List.of(); }"
  ].join("\n"));

  assert.equal(summary.signals.filter((signal) => signal.type === "api_route_changed").length, 2);
});
