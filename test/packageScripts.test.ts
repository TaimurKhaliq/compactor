import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverValidationCommands, preferredValidationCommands, readPackageScripts } from "../src/git/packageScripts.js";

test("reads package.json scripts and filters preferred validation commands", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-scripts-"));

  try {
    writeFileSync(
      join(repoRoot, "package.json"),
      JSON.stringify({
        scripts: {
          build: "tsc",
          test: "vitest",
          typecheck: "tsc --noEmit",
          "ui:test": "npm --prefix ui test",
          start: "node server.js"
        }
      })
    );

    const scripts = readPackageScripts(repoRoot);
    assert.deepEqual(scripts, ["build", "start", "test", "typecheck", "ui:test"]);
    assert.deepEqual(preferredValidationCommands(scripts), [
      "npm test",
      "npm run build",
      "npm run typecheck",
      "npm run ui:test"
    ]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("discovers validation commands beyond package.json", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-validation-"));

  try {
    writeFileSync(join(repoRoot, "Makefile"), "test:\n\tpytest\nlint:\n\truff check .\n");
    writeFileSync(join(repoRoot, "pyproject.toml"), "[tool.pytest.ini_options]\n");
    mkdirSync(join(repoRoot, "tests"));
    writeFileSync(join(repoRoot, "go.mod"), "module example.com/demo\n");
    writeFileSync(join(repoRoot, "Cargo.toml"), "[package]\nname = \"demo\"\n");
    writeFileSync(join(repoRoot, "pom.xml"), "<project></project>\n");
    writeFileSync(join(repoRoot, "Demo.csproj"), "<Project></Project>\n");
    mkdirSync(join(repoRoot, ".github", "workflows"), { recursive: true });
    writeFileSync(join(repoRoot, ".github", "workflows", "test.yml"), "steps:\n  - run: dotnet test\n");

    const commands = discoverValidationCommands(repoRoot);

    assert.ok(commands.includes("make test"));
    assert.ok(commands.includes("make lint"));
    assert.ok(commands.includes("pytest"));
    assert.ok(commands.includes("go test ./..."));
    assert.ok(commands.includes("cargo test"));
    assert.ok(commands.includes("mvn test"));
    assert.ok(commands.includes("dotnet test"));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
