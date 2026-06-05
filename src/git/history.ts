import { execFileSync } from "node:child_process";
import { classifyCommit, collectRepeatedPathPatterns } from "../analysis/classifier.js";
import { learnImplementationFingerprints } from "../analysis/implementationFingerprints.js";
import { learnRepositoryPatterns } from "../analysis/repoLearning.js";
import { parseUnifiedDiff } from "./diffParser.js";
import { discoverValidationCommands, readPackageScripts } from "./packageScripts.js";
import { prepareRepository } from "./repository.js";
import type { RawCommit, ScanResult } from "../types.js";

export interface ScanRepositoryOptions {
  repo?: string;
  repoPath?: string;
  cwd?: string;
  workspaceBasePath?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 50;

export function scanRepository(options: ScanRepositoryOptions = {}): ScanResult {
  const target = prepareRepository({
    repo: options.repo ?? options.repoPath,
    cwd: options.cwd,
    workspaceBasePath: options.workspaceBasePath
  });
  const repoRoot = target.repoRoot;
  const limit = normalizeLimit(options.limit);
  const remoteUrl = getRemoteWebUrl(repoRoot);
  const packageScripts = readPackageScripts(repoRoot);
  const validationCommands = discoverValidationCommands(repoRoot);
  const rawCommits = readRawCommits(repoRoot, limit);
  const commits = rawCommits.map((commit) => {
    const metadata = classifyCommit(commit);
    return {
      ...metadata,
      commitUrl: remoteUrl ? `${remoteUrl}/commit/${commit.hash}` : undefined
    };
  });

  const scanWithoutLearning = {
    repoRoot,
    repositorySource: target.source,
    repositoryInput: target.input,
    workspacePath: target.workspacePath,
    remoteUrl,
    packageScripts,
    validationCommands,
    generatedAt: new Date().toISOString(),
    commitsAnalyzed: commits.length,
    commits,
    repeatedPathPatterns: collectRepeatedPathPatterns(commits)
  };

  const implementationLearning = learnImplementationFingerprints(repoRoot, commits);

  return {
    ...scanWithoutLearning,
    repoLearning: learnRepositoryPatterns(scanWithoutLearning),
    fingerprints: implementationLearning.fingerprints,
    patternFamilies: implementationLearning.patternFamilies
  };
}

export function getRepoRoot(cwd: string): string {
  try {
    return runGit(["rev-parse", "--show-toplevel"], cwd).trim();
  } catch (error) {
    throw new Error(`Not a git repository: ${cwd}`);
  }
}

function readRawCommits(repoRoot: string, limit: number): RawCommit[] {
  const output = runGitOrEmpty(
    ["log", `--max-count=${limit}`, "--date=iso-strict", "--pretty=format:%H%x1f%ad%x1f%s"],
    repoRoot
  );

  if (!output.trim()) {
    return [];
  }

  return output
    .split("\n")
    .map((line) => parseCommitLine(line, repoRoot))
    .filter((commit): commit is RawCommit => Boolean(commit));
}

function parseCommitLine(line: string, repoRoot: string): RawCommit | undefined {
  const [hash, date, ...messageParts] = line.split("\x1f");
  const message = messageParts.join("\x1f");

  if (!hash || !date) {
    return undefined;
  }

  return {
    hash,
    date,
    message,
    ...readCommitDiff(repoRoot, hash)
  };
}

function readCommitDiff(repoRoot: string, hash: string): Pick<RawCommit, "changedFiles" | "diffSummary"> {
  const output = runGitOrEmpty(["show", "--format=", "--unified=3", "--find-renames", hash], repoRoot);
  const diffSummary = parseUnifiedDiff(output);
  const changedFiles = diffSummary.files.map((file) => file.filePath);

  return {
    changedFiles: changedFiles.length > 0 ? changedFiles : readChangedFiles(repoRoot, hash),
    diffSummary
  };
}

function readChangedFiles(repoRoot: string, hash: string): string[] {
  const output = runGitOrEmpty(["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", hash], repoRoot);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function getRemoteWebUrl(repoRoot: string): string | undefined {
  const remote = runGitOrEmpty(["config", "--get", "remote.origin.url"], repoRoot).trim();
  if (!remote) {
    return undefined;
  }

  return normalizeRemoteUrl(remote);
}

function normalizeRemoteUrl(remote: string): string | undefined {
  if (remote.startsWith("git@")) {
    const match = /^git@([^:]+):(.+?)(\.git)?$/.exec(remote);
    if (!match?.[1] || !match?.[2]) {
      return undefined;
    }
    return `https://${match[1]}/${match[2].replace(/\.git$/, "")}`;
  }

  if (remote.startsWith("https://") || remote.startsWith("http://")) {
    return remote.replace(/\.git$/, "");
  }

  return undefined;
}

function normalizeLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit) || limit < 1) {
    return DEFAULT_LIMIT;
  }

  return Math.floor(limit);
}

function runGit(args: string[], cwd: string, silent = false): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    stdio: silent ? ["ignore", "pipe", "ignore"] : ["ignore", "pipe", "pipe"]
  });
}

function runGitOrEmpty(args: string[], cwd: string): string {
  try {
    return runGit(args, cwd, true);
  } catch {
    return "";
  }
}
