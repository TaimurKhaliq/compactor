import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createSafeWorkspaceName,
  getRemoteWorkspacePath,
  isRemoteGitUrl,
  parseRemoteGitUrl,
  prepareRepository
} from "../src/git/repository.js";
import { scanRepository } from "../src/git/history.js";

test("prepareRepository resolves a local path repository", () => {
  const repoRoot = createGitRepo();

  try {
    const target = prepareRepository({ repo: repoRoot });

    assert.equal(target.source, "local");
    assert.equal(target.repoRoot, realpathSync(repoRoot));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("scanRepository defaults to the current working directory repository", () => {
  const repoRoot = createGitRepo();
  const previousCwd = process.cwd();

  try {
    process.chdir(repoRoot);
    const scan = scanRepository({ limit: 5 });

    assert.equal(scan.repoRoot, realpathSync(repoRoot));
    assert.equal(scan.repositorySource, "local");
    assert.equal(scan.commitsAnalyzed, 1);
  } finally {
    process.chdir(previousCwd);
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("parses common remote Git URL formats", () => {
  const https = parseRemoteGitUrl("https://github.com/OpenAI/codex.git");
  const ssh = parseRemoteGitUrl("git@github.com:TaimurKhaliq/compactor.git");

  assert.equal(isRemoteGitUrl("https://github.com/org/repo.git"), true);
  assert.equal(isRemoteGitUrl("git@github.com:org/repo.git"), true);
  assert.equal(isRemoteGitUrl("/Users/example/repo"), false);

  assert.equal(https.host, "github.com");
  assert.equal(https.owner, "OpenAI");
  assert.equal(https.name, "codex");
  assert.equal(https.safeName, "github-com-openai-codex");

  assert.equal(ssh.host, "github.com");
  assert.equal(ssh.owner, "TaimurKhaliq");
  assert.equal(ssh.name, "compactor");
  assert.equal(ssh.safeName, "github-com-taimurkhaliq-compactor");
});

test("builds safe workspace directory names", () => {
  const safeName = createSafeWorkspaceName("github.com", "Some Org", "Repo.Name.git");
  const remote = parseRemoteGitUrl("ssh://git@github.com/Some Org/Repo.Name.git");
  const workspacePath = getRemoteWorkspacePath(remote, "/tmp/compactor-cwd");

  assert.equal(safeName, "github-com-some-org-repo-name");
  assert.equal(workspacePath, "/tmp/compactor-cwd/.compactor/workspaces/github-com-some-org-repo-name");
});

function createGitRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-repo-"));
  git(repoRoot, ["init"]);
  git(repoRoot, ["config", "user.email", "compactor@example.com"]);
  git(repoRoot, ["config", "user.name", "Compactor Test"]);
  writeFileSync(join(repoRoot, "README.md"), "# Test Repo\n");
  git(repoRoot, ["add", "README.md"]);
  git(repoRoot, ["commit", "-m", "Initial commit"]);
  return repoRoot;
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "ignore", "ignore"]
  });
}
