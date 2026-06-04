import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { scanRepository } from "../src/git/history.js";

test("scanRepository reads local git history and changed files", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-git-"));

  try {
    git(repoRoot, ["init"]);
    git(repoRoot, ["config", "user.email", "compactor@example.com"]);
    git(repoRoot, ["config", "user.name", "Compactor Test"]);

    mkdirSync(join(repoRoot, "src", "app", "orders"), { recursive: true });
    writeFileSync(join(repoRoot, "src", "app", "orders", "orders-grid.component.ts"), "export const grid = true;\n");
    git(repoRoot, ["add", "."]);
    git(repoRoot, ["commit", "-m", "Add orders grid"]);

    writeFileSync(join(repoRoot, "src", "app", "orders", "orders-grid.component.spec.ts"), "export const spec = true;\n");
    git(repoRoot, ["add", "."]);
    git(repoRoot, ["commit", "-m", "Test orders grid"]);

    const scan = scanRepository({ repoPath: repoRoot, limit: 10 });

    assert.equal(scan.commitsAnalyzed, 2);
    const latestCommit = scan.commits[0];
    assert.ok(latestCommit, "Expected latest scanned commit");
    assert.equal(latestCommit.message, "Test orders grid");
    assert.ok(latestCommit.changedFiles.includes("src/app/orders/orders-grid.component.spec.ts"));
    assert.ok(scan.repeatedPathPatterns.some((pattern) => pattern.pattern === "grid-table-files"));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "ignore", "ignore"]
  });
}
