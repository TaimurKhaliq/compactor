import { posix as path } from "node:path";
import { discoverValidationCommandsForFiles } from "../git/packageScripts.js";
import type {
  CoChangePair,
  CommitMetadata,
  DirectoryFrequency,
  FileFrequency,
  FileRole,
  FileRoleCounts,
  LearnedSurface,
  RepoLearning,
  ScanResult
} from "../types.js";

interface SurfaceAccumulator {
  directory: string;
  commits: Set<string>;
  sourceFiles: Map<string, number>;
  testFiles: Map<string, number>;
  configOrDocsFiles: Map<string, number>;
  allFiles: Map<string, number>;
  messageTerms: Map<string, Set<string>>;
}

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".java",
  ".kt",
  ".cs",
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".swift",
  ".sql"
]);

const CONFIG_FILE_NAMES = new Set([
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "vite.config.ts",
  "vite.config.js",
  "webpack.config.js",
  "webpack.config.ts",
  "eslint.config.js",
  "eslint.config.mjs",
  "jest.config.js",
  "jest.config.ts",
  "playwright.config.ts",
  "angular.json",
  "nx.json",
  "pyproject.toml",
  "pytest.ini",
  "tox.ini",
  "setup.cfg",
  "go.mod",
  "cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "makefile",
  "dockerfile"
]);

const ROLE_NAMES: FileRole[] = ["source", "test", "config", "docs", "generated", "lockfile", "fixture", "build-output", "unknown"];

const TERM_NOISE = new Set([
  "add",
  "added",
  "update",
  "updated",
  "fix",
  "fixed",
  "improve",
  "improved",
  "refactor",
  "change",
  "changes",
  "file",
  "files",
  "src",
  "source",
  "test",
  "tests",
  "spec",
  "index",
  "main",
  "lib",
  "core",
  "common",
  "shared",
  "generated",
  "fixture",
  "fixtures",
  "report",
  "reports",
  "expected",
  "snapshot",
  "snapshots"
]);

const GENERATED_ARTIFACT_PATH_PATTERNS = [
  /(^|\/)docs\/progress(\/|$)/i,
  /(^|\/)docs\/testfiles\.html$/i,
  /(^|\/)docs\/test-progress\.svg$/i,
  /(^|\/)data\/test-files\.csv$/i,
  /(^|\/)logs?(\/|$)/i,
  /(^|\/)test-results\.md$/i,
  /(^|\/)plan\.md$/i,
  /(^|\/)(coverage|dist|build|generated|reports?|snapshots?|baselines?|replay|fixtures?)(\/|$)/i
];

export function learnRepositoryPatterns(scan: Omit<ScanResult, "repoLearning">): RepoLearning {
  const fileCommitCounts = new Map<string, Set<string>>();
  const directoryCommitCounts = new Map<string, Set<string>>();
  const edgeCounts = new Map<string, { files: [string, string]; commits: Set<string> }>();
  const fileRoles: Record<string, FileRole> = {};

  for (const commit of scan.commits) {
    const files = unique(commit.changedFiles.map(normalizePath).filter(Boolean));
    for (const file of files) {
      const role = inferFileRole(file);
      fileRoles[file] = role;
      addToSetMap(fileCommitCounts, file, commit.hash);
      addToSetMap(directoryCommitCounts, directoryOf(file), commit.hash);
    }

    const coChangeFiles = files.filter(isCoChangeEligibleFile);
    for (let left = 0; left < coChangeFiles.length; left += 1) {
      for (let right = left + 1; right < coChangeFiles.length; right += 1) {
        const a = coChangeFiles[left];
        const b = coChangeFiles[right];
        if (!a || !b) continue;
        const [first, second]: [string, string] = a < b ? [a, b] : [b, a];
        const key = `${first}\x1f${second}`;
        const edge = edgeCounts.get(key) ?? { files: [first, second], commits: new Set<string>() };
        edge.commits.add(commit.hash);
        edgeCounts.set(key, edge);
      }
    }
  }

  const strongestCoChangePairs = [...edgeCounts.values()]
    .map((edge) => coChangePair(edge.files, edge.commits))
    .filter((edge) => edge.weight >= 2)
    .sort(compareCoChangePairs)
    .slice(0, 50);

  const topFilesByFrequency = [...fileCommitCounts.entries()]
    .map(([filePath, commits]) => ({
      filePath,
      commitCount: commits.size,
      role: fileRoles[filePath] ?? inferFileRole(filePath)
    }))
    .sort((a, b) => b.commitCount - a.commitCount || a.filePath.localeCompare(b.filePath))
    .slice(0, 50);

  const topDirectoriesByFrequency = [...directoryCommitCounts.entries()]
    .map(([directory, commits]) => ({ directory, commitCount: commits.size }))
    .sort((a, b) => b.commitCount - a.commitCount || a.directory.localeCompare(b.directory))
    .slice(0, 50);

  const surfaces = buildSurfaces(scan, fileRoles, strongestCoChangePairs);

  return {
    generatedAt: new Date().toISOString(),
    topFilesByFrequency,
    topDirectoriesByFrequency,
    strongestCoChangePairs,
    fileClusters: surfaces,
    surfaces,
    fileRoles
  };
}

export function inferFileRole(filePath: string): FileRole {
  const normalized = normalizePath(filePath);
  const lower = normalized.toLowerCase();
  const base = path.basename(lower);
  const ext = path.extname(lower);

  if (/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|gemfile\.lock|cargo\.lock|go\.sum|poetry\.lock)$/i.test(lower)) {
    return "lockfile";
  }

  if (/(^|\/)(dist|build|coverage|out|target)(\/|$)/i.test(lower)) {
    return "build-output";
  }

  if (isGeneratedArtifactPath(lower)) {
    return "generated";
  }

  if (/(^|\/)(fixtures?|snapshots?|baselines?|replay)(\/|$)/i.test(lower) || /\.(expected|snapshot)\.json$/i.test(lower)) {
    return "fixture";
  }

  if (/(^|\/)(generated|reports?)(\/|$)/i.test(lower) || /\.report\.json$/i.test(lower) || /repo_learning_state\.json$/i.test(lower)) {
    return "generated";
  }

  if (/(\.spec\.|\.(test|tests)\.|_(test|spec)\.)|(^|\/)(__tests__|tests?|specs?|e2e|playwright|cypress)(\/|$)/i.test(lower)) {
    return "test";
  }

  if (/(^|\/)(docs?|documentation)(\/|$)/i.test(lower) || /(^|\/)(readme|changelog|contributing|license)(\.|$)/i.test(lower) || /\.(md|mdx|rst|adoc|txt)$/i.test(lower)) {
    return "docs";
  }

  if (CONFIG_FILE_NAMES.has(base) || /\.(ya?ml|toml|ini|json|env)$/i.test(lower) || /(^|\/)(config|configs|\.github\/workflows)(\/|$)/i.test(lower)) {
    return "config";
  }

  if (SOURCE_EXTENSIONS.has(ext)) {
    return "source";
  }

  return "unknown";
}

export function isGeneratedArtifactPath(filePath: string): boolean {
  const normalized = normalizePath(filePath).toLowerCase();
  return GENERATED_ARTIFACT_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function emptyRoleCounts(): FileRoleCounts {
  return ROLE_NAMES.reduce((counts, role) => {
    counts[role] = 0;
    return counts;
  }, {} as FileRoleCounts);
}

function buildSurfaces(scan: Omit<ScanResult, "repoLearning">, fileRoles: Record<string, FileRole>, edges: CoChangePair[]): LearnedSurface[] {
  const accumulators = new Map<string, SurfaceAccumulator>();

  for (const commit of scan.commits) {
    const files = unique(commit.changedFiles.map(normalizePath));
    const implementationFiles = files.filter((file) => isImplementationSurfaceRole(fileRoles[file] ?? inferFileRole(file)));
    const surfaceDirectories = unique(implementationFiles.map(directoryOf)).filter((directory) => directory !== "repo root");

    for (const directory of surfaceDirectories) {
      const surface = accumulators.get(directory) ?? createSurfaceAccumulator(directory);
      accumulators.set(directory, surface);
      surface.commits.add(commit.hash);

      for (const file of files) {
        incrementMap(surface.allFiles, file);
        const role = fileRoles[file] ?? inferFileRole(file);
        if (isImplementationSurfaceRole(role) && directoryOf(file) === directory) incrementMap(surface.sourceFiles, file);
        if (role === "test") incrementMap(surface.testFiles, file);
        if (role === "config" || (role === "docs" && directoryOf(file) !== directory)) incrementMap(surface.configOrDocsFiles, file);
      }

      for (const term of [...commit.messageTerms, ...implementationFiles.filter((file) => directoryOf(file) === directory).flatMap(pathTerms), ...pathTerms(directory)]) {
        const normalized = normalizeTerm(term);
        if (!normalized || TERM_NOISE.has(normalized)) continue;
        addToSetMap(surface.messageTerms, normalized, commit.hash);
      }
    }
  }

  return [...accumulators.values()]
    .map((surface) => finalizeSurface(scan.repoRoot, surface, fileRoles, edges))
    .filter((surface) => surface.commitCount >= 2 && surface.sourceFileCount > 0 && surface.confidence >= 0.35)
    .sort((a, b) => b.confidence - a.confidence || b.commitCount - a.commitCount || a.commonDirectory.localeCompare(b.commonDirectory))
    .slice(0, 25);
}

function isImplementationSurfaceRole(role: FileRole): boolean {
  return role === "source" || role === "docs";
}

function createSurfaceAccumulator(directory: string): SurfaceAccumulator {
  return {
    directory,
    commits: new Set<string>(),
    sourceFiles: new Map(),
    testFiles: new Map(),
    configOrDocsFiles: new Map(),
    allFiles: new Map(),
    messageTerms: new Map()
  };
}

function finalizeSurface(repoRoot: string, surface: SurfaceAccumulator, fileRoles: Record<string, FileRole>, edges: CoChangePair[]): LearnedSurface {
  const representativeFiles = topMapEntries(surface.sourceFiles, 8);
  const coChangingTestFiles = topMapEntries(surface.testFiles, 8);
  const coChangingConfigOrDocsFiles = topMapEntries(surface.configOrDocsFiles, 8);
  const repeatedTerms = topTermEntries(surface.messageTerms, surface.commits.size).slice(0, 6);
  const roleCounts = roleCountsForFiles([...surface.allFiles.keys()], fileRoles);
  const dominantExtensions = topExtensions([...surface.sourceFiles.keys()]);
  const coChangeEvidence = edges
    .filter((edge) => edge.files.some((file) => surface.sourceFiles.has(file)))
    .sort(compareCoChangePairs)
    .slice(0, 8);
  const validationCommands = discoverValidationCommandsForFiles(repoRoot, [...representativeFiles, ...coChangingTestFiles]);
  const confidence = surfaceConfidence(surface.commits.size, representativeFiles.length, coChangingTestFiles.length, validationCommands.length, coChangeEvidence.length);

  return {
    id: slug(surface.directory),
    displayName: surfaceDisplayName(surface.directory, repeatedTerms),
    commonDirectory: surface.directory,
    representativeFiles,
    coChangingTestFiles,
    coChangingConfigOrDocsFiles,
    dominantExtensions,
    repeatedTerms,
    validationCommands,
    confidence,
    commitCount: surface.commits.size,
    sourceFileCount: representativeFiles.length,
    roleCounts,
    coChangeEvidence,
  };
}

function isCoChangeEligibleFile(filePath: string): boolean {
  if (isGeneratedArtifactPath(filePath)) {
    return false;
  }

  const role = inferFileRole(filePath);
  return role === "source" || role === "test" || role === "config" || role === "docs";
}

function surfaceDisplayName(directory: string, repeatedTerms: string[]): string {
  const directoryTerms = pathTerms(directory).filter((term) => !TERM_NOISE.has(term));
  const meaningful = [...repeatedTerms, ...directoryTerms].filter(Boolean);
  if (meaningful.length === 0) {
    return `${directory} Surface`;
  }

  const selected = dedupeSingularPlural(meaningful).slice(0, 3);
  return `${selected.map(toTitle).join(" ")} Surface`;
}

function surfaceConfidence(commitCount: number, sourceFileCount: number, testFileCount: number, validationCount: number, coChangeCount: number): number {
  const score =
    0.22 +
    Math.min(commitCount, 8) * 0.06 +
    Math.min(sourceFileCount, 6) * 0.035 +
    (testFileCount > 0 ? 0.16 : 0) +
    (validationCount > 0 ? 0.12 : 0) +
    Math.min(coChangeCount, 5) * 0.025;
  return Number(Math.min(0.97, score).toFixed(2));
}

function roleCountsForFiles(files: string[], fileRoles: Record<string, FileRole>): FileRoleCounts {
  const counts = emptyRoleCounts();
  for (const file of files) {
    const role = fileRoles[file] ?? inferFileRole(file);
    counts[role] += 1;
  }
  return counts;
}

function topExtensions(files: string[]): string[] {
  return topValues(files.map((file) => path.extname(file).toLowerCase()).filter(Boolean), 6);
}

function topMapEntries(map: Map<string, number>, limit: number): string[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function topTermEntries(map: Map<string, Set<string>>, commitCount: number): string[] {
  const minCommits = Math.max(2, Math.ceil(commitCount * 0.35));
  return [...map.entries()]
    .map(([term, commits]) => ({ term, commitCount: commits.size }))
    .filter((entry) => entry.commitCount >= minCommits)
    .sort((a, b) => b.commitCount - a.commitCount || a.term.localeCompare(b.term))
    .map((entry) => entry.term);
}

function coChangePair(files: [string, string], commits: Set<string>): CoChangePair {
  return {
    files,
    weight: commits.size,
    sharedCommits: [...commits].sort()
  };
}

function compareCoChangePairs(a: CoChangePair, b: CoChangePair): number {
  return b.weight - a.weight || a.files.join("\x1f").localeCompare(b.files.join("\x1f"));
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}

function incrementMap(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function directoryOf(filePath: string): string {
  const directory = path.dirname(normalizePath(filePath));
  return directory === "." ? "repo root" : directory;
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function pathTerms(value: string): string[] {
  return value.split("/").flatMap((part) => tokenize(part.replace(/\.[^.]+$/i, "")));
}

function tokenize(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3);
}

function normalizeTerm(term: string): string | undefined {
  const normalized = term.toLowerCase().replace(/[^a-z0-9-]+/g, "");
  if (normalized.length < 3 || /^\d+$/.test(normalized)) return undefined;
  return normalized;
}

function dedupeSingularPlural(terms: string[]): string[] {
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    const singular = singularize(term);
    if (seen.has(term) || seen.has(singular)) continue;
    selected.push(term);
    seen.add(term);
    seen.add(singular);
  }
  return selected;
}

function singularize(term: string): string {
  if (term.endsWith("ies") && term.length > 4) return `${term.slice(0, -3)}y`;
  if (term.endsWith("s") && !term.endsWith("ss") && term.length > 3) return term.slice(0, -1);
  return term;
}

function toTitle(term: string): string {
  return term.charAt(0).toUpperCase() + term.slice(1);
}

function topValues(values: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "repo-root";
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}
