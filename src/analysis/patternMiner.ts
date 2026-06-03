import type { CandidateSkill, CommitMetadata, EvidenceCommit, MiningResult, ScanResult } from "../types.js";

interface PatternRule {
  id: string;
  name: string;
  minCommits: number;
  matches: (commit: CommitMetadata) => boolean;
  matchingFiles: (commit: CommitMetadata) => string[];
  rationale: string;
  observedConventions: (commits: CommitMetadata[]) => string[];
  validationCommands: (commits: CommitMetadata[]) => string[];
}

const GRID_TERMS = /(grid|kendo|table|columns)/i;
const TEST_TERMS = /(\.spec\.[jt]sx?|\.test\.[jt]sx?|(^|\/)(playwright|e2e|cypress|__tests__)(\/|$))/i;
const CONFIG_TERMS = /(environment|config|\.env|\.json|\.ya?ml|package\.json|tsconfig|angular\.json|vite\.config|webpack\.config)/i;
const API_TERMS = /(^|\/)(api|routes|controllers|endpoint|server)(\/|$)|\.(controller|route|resolver)\.[jt]s$/i;
const ANGULAR_COMPONENT_TERMS = /\.component\.(ts|html|scss|css|sass|less)$/i;
const ANGULAR_SERVICE_TERMS = /\.service\.ts$/i;

const RULES: PatternRule[] = [
  {
    id: "build-project-grid",
    name: "Build Project Grid",
    minCommits: 2,
    matches: (commit) => hasFileOrMessage(commit, GRID_TERMS),
    matchingFiles: (commit) => commit.changedFiles.filter((file) => GRID_TERMS.test(file)),
    rationale: "Multiple commits repeat grid, table, Kendo, or column-oriented implementation work.",
    observedConventions: gridConventions,
    validationCommands: gridValidationCommands
  },
  {
    id: "add-or-update-tests",
    name: "Add or Update Tests",
    minCommits: 2,
    matches: (commit) => commit.changedFiles.some((file) => TEST_TERMS.test(file)),
    matchingFiles: (commit) => commit.changedFiles.filter((file) => TEST_TERMS.test(file)),
    rationale: "Multiple commits touch unit, integration, or e2e test files.",
    observedConventions: testConventions,
    validationCommands: testValidationCommands
  },
  {
    id: "update-runtime-configuration",
    name: "Update Runtime Configuration",
    minCommits: 2,
    matches: (commit) => commit.changedFiles.some((file) => CONFIG_TERMS.test(file)),
    matchingFiles: (commit) => commit.changedFiles.filter((file) => CONFIG_TERMS.test(file)),
    rationale: "Multiple commits update environment, config, or JSON/YAML runtime files.",
    observedConventions: configConventions,
    validationCommands: configValidationCommands
  },
  {
    id: "add-angular-feature",
    name: "Add Angular Feature",
    minCommits: 2,
    matches: hasAngularFeaturePair,
    matchingFiles: (commit) =>
      commit.changedFiles.filter((file) => ANGULAR_COMPONENT_TERMS.test(file) || ANGULAR_SERVICE_TERMS.test(file)),
    rationale: "Multiple commits change Angular component and service files together.",
    observedConventions: angularConventions,
    validationCommands: angularValidationCommands
  },
  {
    id: "add-api-endpoint",
    name: "Add API Endpoint",
    minCommits: 2,
    matches: (commit) => commit.changedFiles.some((file) => API_TERMS.test(file)) && commit.changedFiles.some((file) => TEST_TERMS.test(file)),
    matchingFiles: (commit) => commit.changedFiles.filter((file) => API_TERMS.test(file) || TEST_TERMS.test(file)),
    rationale: "Multiple commits pair API-facing code with tests.",
    observedConventions: apiConventions,
    validationCommands: apiValidationCommands
  }
];

export function minePatterns(scan: ScanResult): MiningResult {
  const candidates = RULES.map((rule) => buildCandidate(rule, scan.commits, scan.commitsAnalyzed))
    .filter((candidate): candidate is CandidateSkill => Boolean(candidate))
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));

  return {
    repoRoot: scan.repoRoot,
    generatedAt: new Date().toISOString(),
    commitsAnalyzed: scan.commitsAnalyzed,
    candidates
  };
}

function buildCandidate(rule: PatternRule, commits: CommitMetadata[], totalCommits: number): CandidateSkill | undefined {
  const evidenceCommits = commits.filter(rule.matches);

  if (evidenceCommits.length < rule.minCommits) {
    return undefined;
  }

  const matchingFiles = evidenceCommits.flatMap(rule.matchingFiles);
  const commonFiles = topValues(matchingFiles.length > 0 ? matchingFiles : evidenceCommits.flatMap((commit) => commit.changedFiles), 8);
  const commonDirectories = topValues(evidenceCommits.flatMap((commit) => commit.touchedDirectories), 6);
  const matchedPatterns = topValues(evidenceCommits.flatMap((commit) => commit.repeatedPathPatterns), 8);

  return {
    id: rule.id,
    name: rule.name,
    confidence: calculateConfidence(evidenceCommits.length, totalCommits, commonFiles.length + matchedPatterns.length),
    evidenceCommits: evidenceCommits.map(toEvidenceCommit),
    commonFiles,
    commonDirectories,
    observedConventions: rule.observedConventions(evidenceCommits),
    suggestedValidationCommands: rule.validationCommands(evidenceCommits),
    matchedPatterns,
    rationale: rule.rationale
  };
}

function toEvidenceCommit(commit: CommitMetadata): EvidenceCommit {
  return {
    hash: commit.hash,
    shortHash: commit.shortHash,
    message: commit.message,
    changedFiles: commit.changedFiles,
    url: commit.commitUrl
  };
}

function hasFileOrMessage(commit: CommitMetadata, pattern: RegExp): boolean {
  return pattern.test(commit.message) || commit.changedFiles.some((file) => pattern.test(file));
}

function hasAngularFeaturePair(commit: CommitMetadata): boolean {
  const hasComponent = commit.changedFiles.some((file) => ANGULAR_COMPONENT_TERMS.test(file));
  const hasService = commit.changedFiles.some((file) => ANGULAR_SERVICE_TERMS.test(file));
  return hasComponent && hasService;
}

function calculateConfidence(matchCount: number, totalCommits: number, signalCount: number): number {
  const frequencyBoost = totalCommits === 0 ? 0 : Math.min(matchCount / totalCommits, 1) * 0.2;
  const repetitionBoost = Math.min(matchCount, 6) * 0.07;
  const signalBoost = Math.min(signalCount, 8) * 0.015;
  return Number(Math.min(0.95, 0.42 + repetitionBoost + frequencyBoost + signalBoost).toFixed(2));
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

function gridConventions(commits: CommitMetadata[]): string[] {
  const dirs = topValues(commits.flatMap((commit) => commit.touchedDirectories), 3);
  const conventions = [
    `Grid-related changes most often appear under ${formatList(dirs)}.`,
    "File names or commit messages repeatedly use grid, Kendo, table, or columns terminology."
  ];

  if (touchesTests(commits)) {
    conventions.push("Grid work often includes nearby unit or e2e test updates.");
  }

  if (touchesHtmlOrStyles(commits)) {
    conventions.push("Grid behavior changes commonly pair TypeScript updates with template or style files.");
  }

  return conventions;
}

function testConventions(commits: CommitMetadata[]): string[] {
  const files = topValues(commits.flatMap((commit) => commit.changedFiles).filter((file) => TEST_TERMS.test(file)), 4);
  const conventions = [
    `Repeated test changes center on ${formatList(files)}.`,
    "Tests are commonly updated in the same commit as implementation work."
  ];

  if (commits.some((commit) => commit.changedFiles.some((file) => /playwright|e2e|cypress/i.test(file)))) {
    conventions.push("E2E coverage appears in playwright, e2e, or cypress paths.");
  }

  return conventions;
}

function configConventions(commits: CommitMetadata[]): string[] {
  const files = topValues(commits.flatMap((commit) => commit.changedFiles).filter((file) => CONFIG_TERMS.test(file)), 5);
  return [
    `Runtime configuration changes recur in ${formatList(files)}.`,
    "Config work should check related JSON/YAML/env files for matching keys.",
    "Configuration changes are good candidates for build validation because mistakes can be structural rather than type-level."
  ];
}

function angularConventions(commits: CommitMetadata[]): string[] {
  const dirs = topValues(commits.flatMap((commit) => commit.touchedDirectories), 3);
  const conventions = [
    `Angular feature work commonly stays within ${formatList(dirs)}.`,
    "Component files and service files are changed together, suggesting a feature slice pattern."
  ];

  if (touchesTests(commits)) {
    conventions.push("Feature slices often include companion .spec.ts updates.");
  }

  if (touchesHtmlOrStyles(commits)) {
    conventions.push("Template and style updates often travel with the component TypeScript file.");
  }

  return conventions;
}

function apiConventions(commits: CommitMetadata[]): string[] {
  const dirs = topValues(commits.flatMap((commit) => commit.touchedDirectories), 4);
  return [
    `API endpoint changes recur around ${formatList(dirs)}.`,
    "Endpoint-facing code is commonly paired with tests in the same commit.",
    "When adding a route or controller, look for the nearest tested endpoint and mirror its structure."
  ];
}

function gridValidationCommands(commits: CommitMetadata[]): string[] {
  return uniqueCommands(["npm test", "npm run lint", touchesE2E(commits) ? "npm run e2e" : undefined]);
}

function testValidationCommands(commits: CommitMetadata[]): string[] {
  return uniqueCommands(["npm test", touchesE2E(commits) ? "npm run e2e" : undefined, "npm run lint"]);
}

function configValidationCommands(): string[] {
  return ["npm run build", "npm test", "npm run lint"];
}

function angularValidationCommands(commits: CommitMetadata[]): string[] {
  return uniqueCommands(["npm test", "npm run lint", touchesE2E(commits) ? "npm run e2e" : undefined]);
}

function apiValidationCommands(commits: CommitMetadata[]): string[] {
  return uniqueCommands(["npm test", "npm run lint", touchesE2E(commits) ? "npm run e2e" : undefined]);
}

function touchesTests(commits: CommitMetadata[]): boolean {
  return commits.some((commit) => commit.changedFiles.some((file) => TEST_TERMS.test(file)));
}

function touchesE2E(commits: CommitMetadata[]): boolean {
  return commits.some((commit) => commit.changedFiles.some((file) => /(playwright|e2e|cypress)/i.test(file)));
}

function touchesHtmlOrStyles(commits: CommitMetadata[]): boolean {
  return commits.some((commit) => commit.changedFiles.some((file) => /\.(html|css|scss|sass|less)$/i.test(file)));
}

function uniqueCommands(commands: Array<string | undefined>): string[] {
  return [...new Set(commands.filter((command): command is string => Boolean(command)))];
}

function formatList(values: string[]): string {
  if (values.length === 0) {
    return "the same nearby directories";
  }

  return values.map((value) => `\`${value}\``).join(", ");
}
