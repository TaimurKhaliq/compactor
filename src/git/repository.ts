import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

export type RepositorySource = "local" | "remote";

export interface RemoteRepositoryInfo {
  url: string;
  host: string;
  owner?: string;
  name: string;
  safeName: string;
}

export interface RepositoryTarget {
  input: string;
  repoRoot: string;
  source: RepositorySource;
  workspacePath?: string;
  remote?: RemoteRepositoryInfo;
}

export interface PrepareRepositoryOptions {
  repo?: string;
  cwd?: string;
  workspaceBasePath?: string;
}

export function prepareRepository(options: PrepareRepositoryOptions = {}): RepositoryTarget {
  const cwd = resolve(options.cwd ?? process.cwd());
  const input = options.repo ?? cwd;

  if (isRemoteGitUrl(input)) {
    const remote = parseRemoteGitUrl(input);
    const workspacePath = getRemoteWorkspacePath(remote, cwd, options.workspaceBasePath);
    mkdirSync(dirname(workspacePath), { recursive: true });
    cloneOrPullRemote(input, workspacePath);

    return {
      input,
      repoRoot: readRepoRoot(workspacePath),
      source: "remote",
      workspacePath,
      remote
    };
  }

  const localPath = resolve(cwd, input);
  return {
    input,
    repoRoot: readRepoRoot(localPath),
    source: "local"
  };
}

export function isRemoteGitUrl(value: string): boolean {
  return (
    /^git@[^:]+:.+$/i.test(value) ||
    /^(https?|ssh|git|file):\/\/.+/i.test(value)
  );
}

export function parseRemoteGitUrl(url: string): RemoteRepositoryInfo {
  const parsed = parseRemoteParts(url);
  const name = parsed.name || "repository";
  const safeName = createSafeWorkspaceName(parsed.host, parsed.owner, name, url);

  return {
    url,
    host: parsed.host,
    owner: parsed.owner,
    name,
    safeName
  };
}

export function createSafeWorkspaceName(host: string, owner: string | undefined, name: string, fallbackSeed = ""): string {
  const parts = [host, owner, name].filter((part): part is string => Boolean(part));
  const rawName = parts.length > 0 ? parts.join("-") : fallbackSeed;
  const safe = rawName
    .replace(/\.git$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  if (safe) {
    return safe;
  }

  return `remote-${shortHash(fallbackSeed || rawName)}`;
}

export function getRemoteWorkspacePath(
  remote: RemoteRepositoryInfo,
  cwd: string,
  workspaceBasePath?: string
): string {
  const basePath = workspaceBasePath ? resolve(cwd, workspaceBasePath) : join(cwd, ".compactor", "workspaces");
  return join(basePath, remote.safeName);
}

function parseRemoteParts(url: string): { host: string; owner?: string; name?: string } {
  const scpLike = /^git@([^:]+):(.+)$/i.exec(url);
  if (scpLike?.[1] && scpLike?.[2]) {
    return partsFromHostAndPath(scpLike[1], scpLike[2]);
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname || parsed.protocol.replace(/:$/, "") || "remote";
    return partsFromHostAndPath(host, parsed.pathname);
  } catch {
    return {
      host: "remote",
      name: url.replace(/\.git$/i, "")
    };
  }
}

function partsFromHostAndPath(host: string, pathName: string): { host: string; owner?: string; name?: string } {
  let decodedPath = pathName;
  try {
    decodedPath = decodeURIComponent(pathName);
  } catch {
    decodedPath = pathName;
  }
  const pathParts = decodedPath
    .replace(/^\/+/, "")
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean);
  const name = pathParts.at(-1);
  const owner = pathParts.length >= 2 ? pathParts.at(-2) : undefined;

  return {
    host,
    owner,
    name
  };
}

function cloneOrPullRemote(remoteUrl: string, workspacePath: string): void {
  if (!existsSync(workspacePath)) {
    runGit(["clone", remoteUrl, workspacePath], process.cwd());
    return;
  }

  readRepoRoot(workspacePath);
  runGit(["pull", "--ff-only"], workspacePath);
}

function readRepoRoot(cwd: string): string {
  try {
    return runGit(["rev-parse", "--show-toplevel"], cwd).trim();
  } catch {
    throw new Error(`Not a git repository: ${cwd}`);
  }
}

function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function shortHash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 8);
}
