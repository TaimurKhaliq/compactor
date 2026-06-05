import { existsSync, readdirSync, readFileSync } from "node:fs";
import { posix as path } from "node:path";
import { inferFileRole, isGeneratedArtifactPath } from "./repoLearning.js";
import type { CommitMetadata, PatternFamily, PatternFamilySimilarity, SourceFingerprint } from "../types.js";
import type { Dirent } from "node:fs";

interface FingerprintCluster {
  fingerprints: SourceFingerprint[];
  similarities: PatternFamilySimilarity[];
}

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".java",
  ".kt",
  ".cs",
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".swift",
  ".sql",
  ".vue"
]);

const SKIP_DIRECTORIES = new Set([
  ".git",
  ".compactor",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "target",
  "out",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "vendor"
]);

const COMMON_TAGS = new Set([
  "div",
  "span",
  "button",
  "input",
  "form",
  "label",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "nav",
  "p",
  "a",
  "ul",
  "li"
]);

const CONCEPT_TERMS = [
  "grid",
  "table",
  "columns",
  "column",
  "paging",
  "pagination",
  "sorting",
  "sort",
  "filter",
  "search",
  "export",
  "controller",
  "route",
  "router",
  "handler",
  "rest",
  "api",
  "service",
  "repository",
  "command",
  "commands",
  "cli",
  "option",
  "flag",
  "migration",
  "schema",
  "model",
  "entity",
  "query",
  "validation",
  "fixture",
  "component",
  "page",
  "screen"
];

export function learnImplementationFingerprints(repoRoot: string, commits: CommitMetadata[] = []): { fingerprints: SourceFingerprint[]; patternFamilies: PatternFamily[] } {
  const fingerprints = readSourceFilePaths(repoRoot)
    .map((filePath) => fingerprintSourceFile(repoRoot, filePath))
    .filter((fingerprint): fingerprint is SourceFingerprint => Boolean(fingerprint));
  const patternFamilies = buildPatternFamilies(fingerprints, commits);

  return {
    fingerprints,
    patternFamilies
  };
}

export function fingerprintSourceText(filePath: string, text: string): SourceFingerprint {
  const extension = path.extname(filePath).toLowerCase();
  const imports = extractImports(text, extension);
  const libraries = normalizeLibraries(imports);
  const exportedSymbols = extractExportedSymbols(text, extension);
  const classNames = extractClassNames(text, extension);
  const interfaceTypeNames = extractInterfaceTypeNames(text, extension);
  const functionNames = extractFunctionNames(text, extension);
  const testNames = extractTestNames(text);
  const annotations = extractAnnotations(text);
  const decorators = extractDecorators(text);
  const routeDefinitions = extractRouteDefinitions(text, extension);
  const cliOptionDefinitions = extractCliOptionDefinitions(text, extension);
  const schemaModelDefinitions = extractSchemaModelDefinitions(text, extension);
  const migrationOperations = extractMigrationOperations(text, extension);
  const componentTags = extractComponentTags(text, extension);
  const configKeys = extractConfigKeys(text, extension);
  const detectorFeatures = detectTechnologyFeatures(filePath, text, {
    extension,
    imports,
    libraries,
    annotations,
    decorators,
    componentTags,
    routeDefinitions,
    cliOptionDefinitions,
    schemaModelDefinitions,
    migrationOperations
  });
  const roles = unique([
    ...detectorFeatures.roles,
    ...roleHintsFromPath(filePath),
    ...roleHintsFromFeatures({
      routeDefinitions,
      cliOptionDefinitions,
      schemaModelDefinitions,
      migrationOperations,
      componentTags,
      testNames
    })
  ]);
  const concepts = unique([
    ...detectorFeatures.concepts,
    ...conceptsFromText(`${filePath}\n${text}`),
    ...conceptsFromSymbols([...exportedSymbols, ...classNames, ...interfaceTypeNames, ...functionNames])
  ]);

  return {
    path: path.normalize(filePath),
    extension,
    roles,
    frameworks: detectorFeatures.frameworks,
    libraries: unique([...libraries, ...detectorFeatures.libraries]),
    imports,
    exportedSymbols,
    classNames,
    interfaceTypeNames,
    functionNames,
    testNames,
    annotations,
    decorators,
    routeDefinitions,
    cliOptionDefinitions,
    schemaModelDefinitions,
    migrationOperations,
    componentTags,
    configKeys,
    concepts
  };
}

export function buildPatternFamilies(fingerprints: SourceFingerprint[], commits: CommitMetadata[] = []): PatternFamily[] {
  const eligible = fingerprints.filter(isFamilyEligibleFingerprint);
  const clusters: FingerprintCluster[] = [];

  for (const fingerprint of eligible) {
    const best = bestClusterForFingerprint(fingerprint, clusters);
    if (best && best.score >= 0.5) {
      best.cluster.fingerprints.push(fingerprint);
      best.cluster.similarities.push({
        files: [best.anchor.path, fingerprint.path],
        score: Number(best.score.toFixed(2)),
        sharedFeatures: best.sharedFeatures
      });
    } else {
      clusters.push({
        fingerprints: [fingerprint],
        similarities: []
      });
    }
  }

  return clusters
    .filter((cluster) => cluster.fingerprints.length >= 2)
    .map((cluster) => toPatternFamily(cluster, commits))
    .filter((family) => family.confidence >= 0.55)
    .sort((a, b) => b.confidence - a.confidence || b.fileCount - a.fileCount || a.name.localeCompare(b.name))
    .slice(0, 50);
}

export function fingerprintSimilarity(left: SourceFingerprint, right: SourceFingerprint): { score: number; sharedFeatures: string[] } {
  const weights = [
    weightedOverlap("framework", left.frameworks, right.frameworks, 0.2),
    weightedOverlap("library", left.libraries, right.libraries, 0.2),
    weightedOverlap("component tag", left.componentTags, right.componentTags, 0.16),
    weightedOverlap("role", left.roles, right.roles, 0.14),
    weightedOverlap("concept", left.concepts, right.concepts, 0.14),
    weightedOverlap("symbol pattern", symbolPatterns(left), symbolPatterns(right), 0.08),
    weightedOverlap("route", routePatterns(left), routePatterns(right), 0.08),
    weightedOverlap("cli option", left.cliOptionDefinitions, right.cliOptionDefinitions, 0.08),
    weightedOverlap("schema/model", left.schemaModelDefinitions, right.schemaModelDefinitions, 0.08),
    weightedOverlap("test", testPatterns(left), testPatterns(right), 0.04)
  ];
  const score = Math.min(1, weights.reduce((sum, entry) => sum + entry.score, 0));
  const sharedFeatures = unique(weights.flatMap((entry) => entry.sharedFeatures)).slice(0, 12);

  return {
    score: Number(score.toFixed(2)),
    sharedFeatures
  };
}

function readSourceFilePaths(repoRoot: string): string[] {
  const files: string[] = [];
  walk(repoRoot, "", files);
  return files.sort();
}

function walk(repoRoot: string, relativeDirectory: string, files: string[]): void {
  const absoluteDirectory = pathToNative(joinPath(repoRoot, relativeDirectory));
  let entries: Dirent[];
  try {
    entries = readdirSync(absoluteDirectory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    const lowerName = entry.name.toLowerCase();
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(lowerName) && !isGeneratedArtifactPath(relativePath)) {
        walk(repoRoot, relativePath, files);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (SOURCE_EXTENSIONS.has(extension) && inferFileRole(relativePath) !== "generated" && inferFileRole(relativePath) !== "build-output" && inferFileRole(relativePath) !== "fixture") {
      files.push(path.normalize(relativePath));
    }
  }
}

function fingerprintSourceFile(repoRoot: string, filePath: string): SourceFingerprint | undefined {
  const absolutePath = pathToNative(joinPath(repoRoot, filePath));
  if (!existsSync(absolutePath)) {
    return undefined;
  }

  try {
    const text = readFileSync(absolutePath, "utf8");
    if (text.length > 512_000) {
      return undefined;
    }
    return fingerprintSourceText(filePath, text);
  } catch {
    return undefined;
  }
}

function bestClusterForFingerprint(fingerprint: SourceFingerprint, clusters: FingerprintCluster[]): { cluster: FingerprintCluster; anchor: SourceFingerprint; score: number; sharedFeatures: string[] } | undefined {
  let best: { cluster: FingerprintCluster; anchor: SourceFingerprint; score: number; sharedFeatures: string[] } | undefined;

  for (const cluster of clusters) {
    for (const anchor of cluster.fingerprints) {
      const similarity = fingerprintSimilarity(anchor, fingerprint);
      if (similarity.score > (best?.score ?? 0)) {
        best = {
          cluster,
          anchor,
          score: similarity.score,
          sharedFeatures: similarity.sharedFeatures
        };
      }
    }
  }

  return best;
}

function toPatternFamily(cluster: FingerprintCluster, commits: CommitMetadata[]): PatternFamily {
  const fingerprints = cluster.fingerprints;
  const sourceFiles = fingerprints.map((fingerprint) => fingerprint.path).sort();
  const frameworks = topSharedValues(fingerprints.flatMap((fingerprint) => fingerprint.frameworks), 4);
  const libraries = topSharedValues(fingerprints.flatMap((fingerprint) => fingerprint.libraries), 5);
  const concepts = topSharedValues(fingerprints.flatMap((fingerprint) => fingerprint.concepts), 8);
  const roles = topSharedValues(fingerprints.flatMap((fingerprint) => fingerprint.roles), 6);
  const confidence = patternFamilyConfidence(fingerprints, cluster.similarities);
  const name = namePatternFamily({ frameworks, libraries, concepts, roles, sourceFiles });
  const commitCount = countCommitsTouchingFiles(commits, sourceFiles);
  const representativeFiles = representativeFamilyFiles(fingerprints);

  return {
    id: slug(name),
    name,
    representativeFiles,
    frameworks,
    libraries,
    concepts,
    roles,
    confidence,
    fileCount: sourceFiles.length,
    commitCount,
    sourceFiles,
    directories: topSharedValues(sourceFiles.map(directoryForFile), 6),
    similarityScores: cluster.similarities.sort((a, b) => b.score - a.score || a.files.join(" ").localeCompare(b.files.join(" "))).slice(0, 12),
    reasons: familyReasons({ frameworks, libraries, concepts, roles, confidence, sourceFiles })
  };
}

function isFamilyEligibleFingerprint(fingerprint: SourceFingerprint): boolean {
  if (inferFileRole(fingerprint.path) === "test") {
    return false;
  }

  const featureCount = [
    fingerprint.frameworks,
    fingerprint.libraries,
    fingerprint.roles,
    fingerprint.concepts,
    fingerprint.componentTags,
    fingerprint.routeDefinitions,
    fingerprint.cliOptionDefinitions,
    fingerprint.schemaModelDefinitions
  ].reduce((sum, values) => sum + values.length, 0);

  return featureCount >= 2;
}

function patternFamilyConfidence(fingerprints: SourceFingerprint[], similarities: PatternFamilySimilarity[]): number {
  const averageSimilarity = similarities.length === 0
    ? 0.55
    : similarities.reduce((sum, similarity) => sum + similarity.score, 0) / similarities.length;
  const frameworks = topSharedValues(fingerprints.flatMap((fingerprint) => fingerprint.frameworks), 3);
  const libraries = topSharedValues(fingerprints.flatMap((fingerprint) => fingerprint.libraries), 3);
  const concepts = topSharedValues(fingerprints.flatMap((fingerprint) => fingerprint.concepts), 5);
  const roles = topSharedValues(fingerprints.flatMap((fingerprint) => fingerprint.roles), 5);
  let score = averageSimilarity;
  if (frameworks.length > 0) score += 0.08;
  if (libraries.length > 0) score += 0.08;
  if (concepts.length >= 2) score += 0.08;
  if (roles.length > 0) score += 0.05;
  if (fingerprints.length >= 3) score += 0.06;

  return Number(Math.min(0.98, score).toFixed(2));
}

function namePatternFamily(input: { frameworks: string[]; libraries: string[]; concepts: string[]; roles: string[]; sourceFiles: string[] }): string {
  const has = (value: string) => input.concepts.includes(value) || input.roles.includes(value) || input.frameworks.includes(value) || input.libraries.includes(value);
  const framework = preferredFrameworkName(input.frameworks);

  if (has("grid")) {
    const prefix = input.libraries.includes("kendo-angular-grid") || input.libraries.includes("kendo") ? "Kendo" : framework;
    return compactName([prefix, "Grid", input.roles.includes("ui") || input.roles.includes("component") ? "Components" : "Workflow"]);
  }
  if (has("table")) {
    const prefix = input.libraries.includes("ag-grid") ? "AG Grid" : input.libraries.includes("material") ? "Material" : framework;
    return compactName([prefix, "Table", input.roles.includes("ui") || input.roles.includes("component") ? "Components" : "Workflow"]);
  }
  if (has("controller") || has("rest") || has("route") || has("api")) {
    return compactName([framework, "REST", "Controllers"]);
  }
  if (has("command") || has("cli") || has("option") || has("flag")) {
    return compactName([framework, "CLI", "Commands"]);
  }
  if (has("migration") || has("schema")) {
    return compactName([framework, "Database", "Migrations"]);
  }
  if (has("model") || has("entity")) {
    return compactName([framework, "Data", "Models"]);
  }

  const directoryTerms = topSharedValues(input.sourceFiles.flatMap((file) => pathTerms(directoryForFile(file))), 2);
  const concept = input.concepts.find((term) => !["component", "service", "source"].includes(term));
  return compactName([framework, titleCase(concept ?? directoryTerms[0] ?? "Implementation"), "Pattern"]);
}

function familyReasons(input: { frameworks: string[]; libraries: string[]; concepts: string[]; roles: string[]; confidence: number; sourceFiles: string[] }): string[] {
  return [
    `Grouped ${input.sourceFiles.length} source files by implementation fingerprint similarity.`,
    input.frameworks.length > 0 ? `Shared frameworks: ${input.frameworks.join(", ")}.` : "No dominant framework was required for the grouping.",
    input.libraries.length > 0 ? `Shared libraries: ${input.libraries.join(", ")}.` : "No dominant library was required for the grouping.",
    input.concepts.length > 0 ? `Shared concepts: ${input.concepts.slice(0, 6).join(", ")}.` : "No dominant concept terms were repeated.",
    `Pattern family confidence: ${Math.round(input.confidence * 100)}%.`
  ];
}

function preferredFrameworkName(frameworks: string[]): string {
  const preferred = ["angular", "react", "vue", "spring", "fastapi", "express", "rust"];
  const match = preferred.find((framework) => frameworks.includes(framework));
  return match ? titleCase(match) : "";
}

function compactName(parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ")
    .replace(/\bCli\b/g, "CLI")
    .replace(/\bRest\b/g, "REST")
    .replace(/\bApi\b/g, "API");
}

function representativeFamilyFiles(fingerprints: SourceFingerprint[]): string[] {
  return fingerprints
    .map((fingerprint) => ({
      file: fingerprint.path,
      score: fingerprint.frameworks.length * 3 + fingerprint.libraries.length * 3 + fingerprint.concepts.length + fingerprint.roles.length
    }))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .map((entry) => entry.file)
    .slice(0, 8);
}

function countCommitsTouchingFiles(commits: CommitMetadata[], files: string[]): number {
  const fileSet = new Set(files.map((file) => path.normalize(file)));
  return commits.filter((commit) => commit.changedFiles.some((file) => fileSet.has(path.normalize(file)))).length;
}

function weightedOverlap(label: string, left: string[], right: string[], weight: number): { score: number; sharedFeatures: string[] } {
  const a = unique(left);
  const b = unique(right);
  const union = new Set([...a, ...b]).size;
  if (union === 0) {
    return { score: 0, sharedFeatures: [] };
  }
  const shared = a.filter((value) => b.includes(value));
  return {
    score: (shared.length / union) * weight,
    sharedFeatures: shared.map((value) => `${label}:${value}`)
  };
}

function extractImports(text: string, extension: string): string[] {
  const imports: string[] = [];
  for (const match of text.matchAll(/\bimport\s+(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g)) imports.push(match[1] ?? "");
  for (const match of text.matchAll(/\brequire\(["']([^"']+)["']\)/g)) imports.push(match[1] ?? "");
  for (const match of text.matchAll(/^\s*from\s+([\w.]+)\s+import\b/gm)) imports.push(match[1] ?? "");
  for (const match of text.matchAll(/^\s*import\s+([\w.]+)\b/gm)) imports.push(match[1] ?? "");
  for (const match of text.matchAll(/^\s*import\s+([\w.*]+);/gm)) imports.push(match[1] ?? "");
  if (extension === ".rs") {
    for (const match of text.matchAll(/^\s*use\s+([\w:]+)(?:;|::)/gm)) imports.push(match[1] ?? "");
  }
  return unique(imports.map((value) => value.trim()).filter(Boolean));
}

function normalizeLibraries(imports: string[]): string[] {
  return unique(imports.map((library) => {
    if (library.startsWith("@")) {
      const parts = library.split("/");
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : library;
    }
    return library.split(/[/.]/)[0] ?? library;
  }).filter(Boolean));
}

function extractExportedSymbols(text: string, extension: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/\bexport\s+(?:default\s+)?(?:abstract\s+)?(?:class|function|interface|type|enum|const|let|var)\s+([A-Za-z_][\w]*)/g)) names.push(match[1] ?? "");
  if (extension === ".rs") {
    for (const match of text.matchAll(/\bpub\s+(?:struct|enum|fn|trait)\s+([A-Za-z_][\w]*)/g)) names.push(match[1] ?? "");
  }
  return unique(names);
}

function extractClassNames(text: string, extension: string): string[] {
  const names = [...text.matchAll(/\bclass\s+([A-Za-z_][\w]*)/g)].map((match) => match[1] ?? "");
  if (extension === ".rs") {
    names.push(...[...text.matchAll(/\bstruct\s+([A-Za-z_][\w]*)/g)].map((match) => match[1] ?? ""));
  }
  return unique(names);
}

function extractInterfaceTypeNames(text: string, extension: string): string[] {
  const names = [
    ...[...text.matchAll(/\binterface\s+([A-Za-z_][\w]*)/g)].map((match) => match[1] ?? ""),
    ...[...text.matchAll(/\btype\s+([A-Za-z_][\w]*)/g)].map((match) => match[1] ?? "")
  ];
  if (extension === ".rs") {
    names.push(...[...text.matchAll(/\btrait\s+([A-Za-z_][\w]*)/g)].map((match) => match[1] ?? ""));
  }
  return unique(names);
}

function extractFunctionNames(text: string, extension: string): string[] {
  const names = [
    ...[...text.matchAll(/\bfunction\s+([A-Za-z_][\w]*)/g)].map((match) => match[1] ?? ""),
    ...[...text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_][\w]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g)].map((match) => match[1] ?? ""),
    ...[...text.matchAll(/^\s*(?:async\s+)?([A-Za-z_][\w]*)\s*\([^)]*\)\s*(?::[^{]+)?\{/gm)].map((match) => match[1] ?? "")
  ];
  if (extension === ".py") names.push(...[...text.matchAll(/^\s*def\s+([A-Za-z_][\w]*)\s*\(/gm)].map((match) => match[1] ?? ""));
  if (extension === ".rs") names.push(...[...text.matchAll(/\bfn\s+([A-Za-z_][\w]*)\s*\(/g)].map((match) => match[1] ?? ""));
  return unique(names.filter((name) => !["if", "for", "while", "switch", "catch"].includes(name)));
}

function extractTestNames(text: string): string[] {
  return unique([...text.matchAll(/\b(?:describe|it|test)\s*\(\s*["'`]([^"'`]+)["'`]/g)].map((match) => match[1] ?? ""));
}

function extractAnnotations(text: string): string[] {
  return unique([
    ...[...text.matchAll(/@([A-Za-z_][\w]*)/g)].map((match) => match[1] ?? ""),
    ...[...text.matchAll(/#\[\s*([A-Za-z_][\w]*)/g)].map((match) => match[1] ?? "")
  ]);
}

function extractDecorators(text: string): string[] {
  return unique([...text.matchAll(/@([A-Za-z_][\w]*)\s*(?:\(|\n)/g)].map((match) => match[1] ?? ""));
}

function extractRouteDefinitions(text: string, extension: string): string[] {
  const routes = [
    ...[...text.matchAll(/\b(?:router|app|server)\.(?:get|post|put|patch|delete|use)\s*\(\s*["'`]([^"'`]+)["'`]/gi)].map((match) => match[1] ?? ""),
    ...[...text.matchAll(/@(Get|Post|Put|Patch|Delete|RequestMapping)\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g)].map((match) => `${match[1]} ${match[2]}`),
    ...[...text.matchAll(/@(?:app|router)\.(?:get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/g)].map((match) => match[1] ?? "")
  ];
  if (extension === ".py") {
    routes.push(...[...text.matchAll(/APIRouter\s*\(/g)].map(() => "APIRouter"));
  }
  return unique(routes);
}

function extractCliOptionDefinitions(text: string, extension: string): string[] {
  const options = [
    ...[...text.matchAll(/\.option\s*\(\s*["'`]([^"'`]+)["'`]/g)].map((match) => match[1] ?? ""),
    ...[...text.matchAll(/(?:--[a-z][\w-]+)/gi)].map((match) => match[0]),
    ...[...text.matchAll(/@Option\s*\(\s*(?:name\s*=\s*)?["']([^"']+)["']/g)].map((match) => match[1] ?? "")
  ];
  if (extension === ".rs") {
    options.push(...[...text.matchAll(/#\[\s*(?:arg|clap)\b[^\]]*\]/g)].map((match) => match[0]));
    options.push(...[...text.matchAll(/\bArg::new\s*\(\s*["']([^"']+)["']/g)].map((match) => match[1] ?? ""));
  }
  return unique(options);
}

function extractSchemaModelDefinitions(text: string, extension: string): string[] {
  const models = [
    ...[...text.matchAll(/@(?:Entity|Table)\b/g)].map((match) => match[0]),
    ...[...text.matchAll(/\bmodel\s+([A-Za-z_][\w]*)\s*\{/g)].map((match) => match[1] ?? ""),
    ...[...text.matchAll(/\bCREATE\s+TABLE\s+([A-Za-z_][\w.]*)/gi)].map((match) => match[1] ?? "")
  ];
  if (extension === ".java" || extension === ".kt") {
    models.push(...[...text.matchAll(/\b(?:extends\s+JpaRepository|CrudRepository|Repository<)/g)].map((match) => match[0]));
  }
  return unique(models);
}

function extractMigrationOperations(text: string, extension: string): string[] {
  if (extension !== ".sql" && !/migration|migrations|schema/i.test(text)) {
    return [];
  }
  return unique([
    ...[...text.matchAll(/\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX)\b/gi)].map((match) => `${(match[1] ?? "").toLowerCase()} ${(match[2] ?? "").toLowerCase()}`),
    ...[...text.matchAll(/\b(createTable|alterTable|addColumn|dropColumn|createIndex)\b/g)].map((match) => match[1] ?? "")
  ]);
}

function extractComponentTags(text: string, extension: string): string[] {
  if (![".ts", ".tsx", ".js", ".jsx", ".vue"].includes(extension) && !/@Component|template\s*:|<template/i.test(text)) {
    return [];
  }

  const tags = [...text.matchAll(/<([a-z][\w-]*)\b/gi)]
    .map((match) => (match[1] ?? "").toLowerCase())
    .filter((tag) => tag.includes("-") || !COMMON_TAGS.has(tag));
  return unique(tags);
}

function extractConfigKeys(text: string, extension: string): string[] {
  if (![".json", ".yaml", ".yml", ".toml"].includes(extension)) {
    return [];
  }
  return unique([...text.matchAll(/["']?([A-Za-z_][\w-]*)["']?\s*[:=]/g)].map((match) => match[1] ?? ""));
}

function detectTechnologyFeatures(
  filePath: string,
  text: string,
  features: {
    extension: string;
    imports: string[];
    libraries: string[];
    annotations: string[];
    decorators: string[];
    componentTags: string[];
    routeDefinitions: string[];
    cliOptionDefinitions: string[];
    schemaModelDefinitions: string[];
    migrationOperations: string[];
  }
): { frameworks: string[]; libraries: string[]; roles: string[]; concepts: string[] } {
  const frameworks: string[] = [];
  const libraries: string[] = [];
  const roles: string[] = [];
  const concepts: string[] = [];
  const lowerText = text.toLowerCase();
  const lowerPath = filePath.toLowerCase();
  const hasImport = (pattern: RegExp) => features.imports.some((value) => pattern.test(value)) || features.libraries.some((value) => pattern.test(value));

  if (/@Component\b|templateUrl\b|standalone\s*:|\binject\s*\(|\bsignal\s*\(/.test(text) || hasImport(/@angular\//)) {
    frameworks.push("angular");
    roles.push("ui", "component");
  }
  if (features.extension === ".tsx" || /\buseState\s*\(|\buseEffect\s*\(|from\s+["']react["']/.test(text) || hasImport(/^react$/)) {
    frameworks.push("react");
    roles.push("ui", "component");
  }
  if (/\bdefineComponent\s*\(|<template\b/.test(text)) {
    frameworks.push("vue");
    roles.push("ui", "component");
  }
  if (/kendo-grid|GridDataResult|GridModule/.test(text) || hasImport(/kendo/i)) {
    libraries.push("kendo-angular-grid");
    roles.push("ui", "grid");
    concepts.push("grid", "columns");
  }
  if (/ag-grid|AgGrid/.test(text) || hasImport(/ag-grid/i)) {
    libraries.push("ag-grid");
    roles.push("ui", "grid");
    concepts.push("grid", "columns");
  }
  if (/mat-table|MatTable|MatTableModule/.test(text) || hasImport(/material/i)) {
    libraries.push("material");
    roles.push("ui");
    concepts.push("table");
  }
  if (/@RestController\b|@Controller\b/.test(text)) {
    frameworks.push("spring");
    roles.push("api", "controller");
    concepts.push("rest", "controller");
  }
  if (/@Service\b/.test(text)) {
    frameworks.push("spring");
    roles.push("service");
  }
  if (/\bRouter\s*\(|\bexpress\s*\(|from\s+["']express["']|require\(["']express["']\)/.test(text)) {
    frameworks.push("express");
    roles.push("api", "route");
    concepts.push("api", "route");
  }
  if (/\bAPIRouter\s*\(|from\s+fastapi\s+import/.test(text)) {
    frameworks.push("fastapi");
    roles.push("api", "route");
    concepts.push("api", "route");
  }
  if (/\bprisma\b/i.test(text) || hasImport(/prisma/i)) {
    libraries.push("prisma");
    roles.push("database");
    concepts.push("model", "query");
  }
  if (/@Entity\b|typeorm/i.test(text) || hasImport(/typeorm/i)) {
    libraries.push("typeorm");
    roles.push("database");
    concepts.push("entity", "model");
  }
  if (/@Entity\b|JpaRepository|CrudRepository/.test(text)) {
    libraries.push("jpa");
    roles.push("database", "repository");
    concepts.push("entity", "repository");
  }
  if (/\bclap\b|\bstructopt\b|\bargh\b|#\[\s*(?:arg|clap)/i.test(text) || hasImport(/^(clap|structopt|argh)$/)) {
    frameworks.push("rust");
    libraries.push(/structopt/i.test(text) ? "structopt" : /argh/i.test(text) ? "argh" : "clap");
    roles.push("cli");
    concepts.push("command", "option");
  }
  if (features.routeDefinitions.length > 0) roles.push("api", "route");
  if (features.cliOptionDefinitions.length > 0 || /(^|\/)(commands?|cmd|cli)(\/|$)/i.test(lowerPath)) roles.push("cli");
  if (features.schemaModelDefinitions.length > 0 || features.migrationOperations.length > 0) roles.push("database");
  if (features.componentTags.length > 0) roles.push("ui", "component");
  if (/\b(export|download|csv|xlsx)\b/.test(lowerText)) concepts.push("export");
  if (/\b(page|paging|paginate|pagination)\b/.test(lowerText)) concepts.push("paging", "pagination");
  if (/\b(sort|sorting|sortable)\b/.test(lowerText)) concepts.push("sorting");
  if (/\b(filter|filtering|search)\b/.test(lowerText)) concepts.push("filter", "search");

  return {
    frameworks: unique(frameworks),
    libraries: unique(libraries),
    roles: unique(roles),
    concepts: unique(concepts)
  };
}

function roleHintsFromPath(filePath: string): string[] {
  const lower = filePath.toLowerCase();
  const roles: string[] = [];
  if (/(^|\/)(components?|pages?|screens?|views?|ui|web|frontend)(\/|$)/.test(lower) || /\.(tsx|jsx|vue)$/.test(lower)) roles.push("ui");
  if (/(^|\/)(commands?|cmd|cli)(\/|$)/.test(lower)) roles.push("cli");
  if (/(^|\/)(controllers?|routes?|handlers?)(\/|$)/.test(lower)) roles.push("api", "controller");
  if (/(^|\/)(services?)(\/|$)/.test(lower)) roles.push("service");
  if (/(^|\/)(repositories?|dao)(\/|$)/.test(lower)) roles.push("repository");
  if (/(^|\/)(migrations?|schema|models?|entities?)(\/|$)/.test(lower) || /\.(sql|prisma)$/.test(lower)) roles.push("database");
  if (inferFileRole(filePath) === "test") roles.push("test");
  return roles;
}

function roleHintsFromFeatures(features: {
  routeDefinitions: string[];
  cliOptionDefinitions: string[];
  schemaModelDefinitions: string[];
  migrationOperations: string[];
  componentTags: string[];
  testNames: string[];
}): string[] {
  const roles: string[] = [];
  if (features.routeDefinitions.length > 0) roles.push("api");
  if (features.cliOptionDefinitions.length > 0) roles.push("cli");
  if (features.schemaModelDefinitions.length > 0 || features.migrationOperations.length > 0) roles.push("database");
  if (features.componentTags.length > 0) roles.push("ui", "component");
  if (features.testNames.length > 0) roles.push("test");
  return roles;
}

function conceptsFromText(text: string): string[] {
  const lower = text.toLowerCase();
  return CONCEPT_TERMS.filter((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`).test(lower)).map(normalizeConcept);
}

function conceptsFromSymbols(symbols: string[]): string[] {
  return unique(symbols.flatMap(splitIdentifier).map(normalizeConcept).filter((term) => CONCEPT_TERMS.includes(term)));
}

function symbolPatterns(fingerprint: SourceFingerprint): string[] {
  return unique([...fingerprint.exportedSymbols, ...fingerprint.classNames, ...fingerprint.interfaceTypeNames, ...fingerprint.functionNames].flatMap(splitIdentifier).map(normalizeConcept).filter((term) => !["user", "profile", "account", "customer", "order"].includes(term)));
}

function routePatterns(fingerprint: SourceFingerprint): string[] {
  return unique(fingerprint.routeDefinitions.map((route) => route.replace(/\/:[^/]+/g, "/:param").replace(/\{[^}]+\}/g, "{param}").toLowerCase()));
}

function testPatterns(fingerprint: SourceFingerprint): string[] {
  return unique(fingerprint.testNames.flatMap(splitIdentifier).map(normalizeConcept));
}

function pathTerms(value: string): string[] {
  return value
    .split(/[\/_.\-\s]+/)
    .flatMap(splitIdentifier)
    .map(normalizeConcept)
    .filter((term) => term.length > 2);
}

function splitIdentifier(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.toLowerCase())
    .filter(Boolean);
}

function normalizeConcept(value: string): string {
  if (value === "columns" || value === "column") return "columns";
  if (value === "sort" || value === "sortable") return "sorting";
  if (value === "paginate") return "pagination";
  if (value === "commands") return "command";
  if (value === "controllers") return "controller";
  if (value === "routes") return "route";
  if (value === "models") return "model";
  if (value === "entities") return "entity";
  return value.toLowerCase();
}

function topSharedValues(values: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const repeated = [...counts.entries()].filter(([, count]) => count >= 2);
  const source = repeated.length > 0 ? repeated : [...counts.entries()];
  return source
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function directoryForFile(file: string): string {
  const directory = path.dirname(file);
  return directory === "." ? "repo root" : directory;
}

function joinPath(left: string, right: string): string {
  return right ? `${left.replace(/\/$/, "")}/${right}` : left;
}

function pathToNative(value: string): string {
  return value;
}

function titleCase(value: string): string {
  return value.split(/[\s-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
