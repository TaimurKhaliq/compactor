import { posix as path } from "node:path";
import type { CommitMetadata, LikelyArea, PatternCount, RawCommit } from "../types.js";

const TEST_PATTERNS = [
  /\.spec\.[jt]sx?$/i,
  /\.test\.[jt]sx?$/i,
  /(^|\/)__tests__(\/|$)/i,
  /(^|\/)(e2e|playwright|cypress)(\/|$)/i,
  /playwright\.config\.[jt]s$/i
];

const CONFIG_PATTERNS = [
  /(^|\/)(environment|env)(\.|\/|-|_)/i,
  /(^|\/)\.env/i,
  /(^|\/)(config|configs)(\/|$)/i,
  /(^|\/)(package|package-lock|pnpm-lock|yarn\.lock|tsconfig|vite\.config|webpack\.config|angular\.json|nx\.json|jest\.config|eslint\.config)/i,
  /\.(json|ya?ml|toml|ini)$/i
];

const DOC_PATTERNS = [
  /(^|\/)(docs|documentation)(\/|$)/i,
  /(^|\/)(readme|changelog|contributing|license)(\.|$)/i,
  /\.(md|mdx|rst|txt)$/i
];

const FRONTEND_PATTERNS = [
  /(^|\/)(src\/app|components|component|pages|views|ui|styles|assets)(\/|$)/i,
  /\.(component|directive|pipe|module)\.ts$/i,
  /\.(tsx|jsx|html|css|scss|sass|less)$/i
];

const BACKEND_PATTERNS = [
  /(^|\/)(api|server|backend|routes|controllers|middleware|models|repositories|migrations|db|database)(\/|$)/i,
  /\.(controller|resolver|route|middleware|model|schema)\.[jt]s$/i
];

export function classifyCommit(commit: RawCommit): CommitMetadata {
  const fileExtensions = uniqueSorted(commit.changedFiles.map(extractFileExtension).filter(Boolean));
  const touchedDirectories = uniqueSorted(commit.changedFiles.map(extractTouchedDirectory));
  const repeatedPathPatterns = uniqueSorted(commit.changedFiles.flatMap(extractFilePathPatterns));
  const likelyArea = classifyCommitArea(commit.changedFiles);

  return {
    ...commit,
    shortHash: commit.hash.slice(0, 7),
    fileExtensions,
    likelyArea,
    repeatedPathPatterns,
    touchedDirectories
  };
}

export function extractFileExtension(filePath: string): string {
  const normalized = normalizePath(filePath);
  const base = path.basename(normalized).toLowerCase();

  if (base === ".env" || base.startsWith(".env.")) {
    return ".env";
  }

  const ext = path.extname(base);
  return ext || "";
}

export function classifyFileArea(filePath: string): LikelyArea {
  const normalized = normalizePath(filePath);

  if (matchesAny(normalized, TEST_PATTERNS)) {
    return "tests";
  }

  if (matchesAny(normalized, DOC_PATTERNS)) {
    return "docs";
  }

  if (matchesAny(normalized, CONFIG_PATTERNS)) {
    return "config";
  }

  if (matchesAny(normalized, FRONTEND_PATTERNS)) {
    return "frontend";
  }

  if (matchesAny(normalized, BACKEND_PATTERNS)) {
    return "backend";
  }

  return "unknown";
}

export function classifyCommitArea(files: string[]): LikelyArea {
  if (files.length === 0) {
    return "unknown";
  }

  const counts = new Map<LikelyArea, number>();
  for (const file of files) {
    const area = classifyFileArea(file);
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top) {
    return "unknown";
  }

  const [area, count] = top;
  if (area === "unknown" && ranked.length > 1) {
    return "mixed";
  }

  if (ranked.length > 1 && count / files.length < 0.6) {
    return "mixed";
  }

  return area;
}

export function extractFilePathPatterns(filePath: string): string[] {
  const normalized = normalizePath(filePath);
  const lower = normalized.toLowerCase();
  const patterns = new Set<string>();
  const parts = normalized.split("/").filter(Boolean);

  if (parts.length >= 1) {
    patterns.add(`${parts[0]}/**`);
  }

  if (parts.length >= 2) {
    patterns.add(`${parts[0]}/${parts[1]}/**`);
  }

  if (parts.length >= 3) {
    patterns.add(`${parts[0]}/${parts[1]}/${parts[2]}/**`);
  }

  if (/(grid|kendo|table|columns)/i.test(lower)) {
    patterns.add("grid-table-files");
  }

  if (/\.component\.(ts|html|css|scss|sass|less)$/i.test(lower)) {
    patterns.add("angular-component-files");
  }

  if (/\.service\.ts$/i.test(lower)) {
    patterns.add("service-files");
  }

  if (/\.spec\.ts$/i.test(lower) || /\.test\.[jt]sx?$/i.test(lower)) {
    patterns.add("unit-test-files");
  }

  if (/(^|\/)(playwright|e2e|cypress)(\/|$)/i.test(lower)) {
    patterns.add("e2e-test-files");
  }

  if (/(environment|config|\.env|\.json|\.ya?ml)/i.test(lower)) {
    patterns.add("configuration-files");
  }

  if (/(^|\/)(api|routes|controllers|endpoint|server)(\/|$)/i.test(lower)) {
    patterns.add("api-endpoint-files");
  }

  if (/(^|\/)(docs|readme|changelog|contributing)(\/|\.|$)/i.test(lower)) {
    patterns.add("documentation-files");
  }

  return [...patterns];
}

export function collectRepeatedPathPatterns(commits: CommitMetadata[], minCount = 2): PatternCount[] {
  const counts = new Map<string, Set<string>>();

  for (const commit of commits) {
    for (const pattern of commit.repeatedPathPatterns) {
      if (!counts.has(pattern)) {
        counts.set(pattern, new Set());
      }
      counts.get(pattern)?.add(commit.shortHash);
    }
  }

  return [...counts.entries()]
    .map(([pattern, commitSet]) => ({
      pattern,
      count: commitSet.size,
      commits: [...commitSet].sort()
    }))
    .filter((entry) => entry.count >= minCount)
    .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern));
}

export function extractTouchedDirectory(filePath: string): string {
  const normalized = normalizePath(filePath);
  const directory = path.dirname(normalized);
  return directory === "." ? "repo root" : directory;
}

export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}
