import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { preferredValidationCommands, readPackageScripts } from "../src/git/packageScripts.js";

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
