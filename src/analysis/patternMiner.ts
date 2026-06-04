import { posix as path } from "node:path";
import { preferredValidationCommands } from "../git/packageScripts.js";
import type { CandidateSkill, CommitMetadata, DiffSignal, EvidenceCommit, MiningResult, ScanResult } from "../types.js";

interface PatternRule {
  id: string;
  name: string;
  minCommits: number;
  matches: (commit: CommitMetadata) => boolean;
  matchingFiles: (commit: CommitMetadata) => string[];
  diffSignalTypes?: DiffSignal["type"][];
  rationale: string;
  observedConventions: (commits: CommitMetadata[]) => string[];
  falsePositiveNotes: string[];
}

const GRID_TERMS = /(grid|kendo|table|columns)/i;
const TEST_TERMS = /(\.spec\.[jt]sx?|\.test\.[jt]sx?|(^|\/)(playwright|e2e|cypress|__tests__)(\/|$))/i;
const CONFIG_TERMS = /(environment|config|\.env|\.json|\.ya?ml|package\.json|tsconfig|angular\.json|vite\.config|webpack\.config)/i;
const ANGULAR_COMPONENT_TERMS = /\.component\.(ts|html|scss|css|sass|less)$/i;
const ANGULAR_SERVICE_TERMS = /\.service\.ts$/i;
const UI_FILE_TERMS = /(^|\/)ui\/(src|tests)(\/|$)|(^|\/)ui\/.*\.(tsx|jsx|ts|js|css|scss)$/i;
const PRODUCT_ANALYSIS_TERMS = /(critic|audit|report|heuristic|evidence)/i;

const RULES: PatternRule[] = [
  {
    id: "build-project-grid",
    name: "Build Project Grid",
    minCommits: 2,
    matches: (commit) => hasFileOrMessage(commit, GRID_TERMS),
    matchingFiles: (commit) => commit.changedFiles.filter((file) => GRID_TERMS.test(file)),
    rationale: "Multiple commits repeat grid, table, Kendo, or column-oriented implementation work.",
    observedConventions: gridConventions,
    falsePositiveNotes: ["Grid detection still uses path and message terms, so review nearest examples before promoting this skill."]
  },
  {
    id: "add-or-update-tests",
    name: "Add or Update Tests",
    minCommits: 2,
    matches: (commit) => commit.changedFiles.some((file) => TEST_TERMS.test(file)) || hasDiffSignal(commit, "test-name"),
    matchingFiles: (commit) => commit.changedFiles.filter((file) => TEST_TERMS.test(file)),
    diffSignalTypes: ["test-name"],
    rationale: "Multiple commits add or update test files or named test cases.",
    observedConventions: testConventions,
    falsePositiveNotes: ["Large commits that touch tests and implementation together may overstate test-specific repetition."]
  },
  {
    id: "update-runtime-configuration",
    name: "Update Runtime Configuration",
    minCommits: 2,
    matches: (commit) =>
      commit.changedFiles.some((file) => CONFIG_TERMS.test(file)) ||
      hasAnyDiffSignal(commit, ["config-key", "package-script"]),
    matchingFiles: (commit) =>
      commit.changedFiles.filter((file) => CONFIG_TERMS.test(file)).concat(filesWithSignals(commit, ["config-key", "package-script"])),
    diffSignalTypes: ["config-key", "package-script"],
    rationale: "Multiple commits update environment, config, JSON/YAML, or package script settings.",
    observedConventions: configConventions,
    falsePositiveNotes: ["Config signals are structural; verify whether changed keys are runtime settings or test fixture data."]
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
    falsePositiveNotes: ["Angular feature detection is path based and should be reviewed in non-Angular repositories."]
  },
  {
    id: "add-api-endpoint",
    name: "Add API Endpoint",
    minCommits: 2,
    matches: (commit) => hasAnyDiffSignal(commit, ["api-route", "route-handler"]),
    matchingFiles: (commit) => filesWithSignals(commit, ["api-route", "route-handler"]),
    diffSignalTypes: ["api-route", "route-handler"],
    rationale: "Multiple commits add visible route or handler-like code in diffs.",
    observedConventions: apiConventions,
    falsePositiveNotes: ["This rule ignores server paths unless added lines show route or handler patterns."]
  },
  {
    id: "add-or-update-cli-feature",
    name: "Add or Update CLI Feature",
    minCommits: 2,
    matches: (commit) => hasAnyDiffSignal(commit, ["cli-command", "cli-option"]),
    matchingFiles: (commit) => filesWithSignals(commit, ["cli-command", "cli-option"]),
    diffSignalTypes: ["cli-command", "cli-option"],
    rationale: "Multiple commits add CLI commands or options in implementation diffs.",
    observedConventions: cliConventions,
    falsePositiveNotes: ["CLI detection requires command or option syntax in added lines; pure refactors may be missed."]
  },
  {
    id: "add-or-update-ui-server-feature",
    name: "Add or Update UI Server Feature",
    minCommits: 2,
    matches: hasUiServerFeature,
    matchingFiles: (commit) => commit.changedFiles.filter((file) => file === "server/uiServer.ts" || UI_FILE_TERMS.test(file)),
    diffSignalTypes: ["api-route", "route-handler", "test-name"],
    rationale: "Multiple commits change server/uiServer.ts together with UI files or UI tests.",
    observedConventions: uiServerConventions,
    falsePositiveNotes: ["This rule requires server/uiServer.ts plus UI-side files in the same commit."]
  },
  {
    id: "add-or-update-product-analysis-feature",
    name: "Add or Update Product Analysis Feature",
    minCommits: 2,
    matches: (commit) => commit.changedFiles.some((file) => PRODUCT_ANALYSIS_TERMS.test(file)),
    matchingFiles: (commit) => commit.changedFiles.filter((file) => PRODUCT_ANALYSIS_TERMS.test(file)),
    rationale: "Multiple commits involve critic, audit, report, heuristic, or evidence-oriented files.",
    observedConventions: productAnalysisConventions,
    falsePositiveNotes: ["This rule is domain-term based; review evidence to separate product analysis work from generic reporting."]
  }
];

export function minePatterns(scan: ScanResult): MiningResult {
  const candidates = RULES.map((rule) => buildCandidate(rule, scan))
    .filter((candidate): candidate is CandidateSkill => Boolean(candidate))
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));

  return {
    repoRoot: scan.repoRoot,
    generatedAt: new Date().toISOString(),
    commitsAnalyzed: scan.commitsAnalyzed,
    candidates
  };
}

function buildCandidate(rule: PatternRule, scan: ScanResult): CandidateSkill | undefined {
  const evidenceCommits = scan.commits.filter(rule.matches);

  if (evidenceCommits.length < rule.minCommits) {
    return undefined;
  }

  const matchingFiles = unique(evidenceCommits.flatMap(rule.matchingFiles));
  const commonFiles = topValues(matchingFiles.length > 0 ? matchingFiles : evidenceCommits.flatMap((commit) => commit.changedFiles), 8);
  const commonDirectories = topValues(evidenceCommits.flatMap((commit) => commit.touchedDirectories), 6);
  const matchedPatterns = topValues(evidenceCommits.flatMap((commit) => commit.repeatedPathPatterns), 8);
  const diffSignals = topDiffSignals(evidenceCommits, 10, rule.diffSignalTypes);
  const pathSignals = topValues([...matchedPatterns, ...commonFiles.map((file) => `file:${file}`)], 10);
  const signalCount = evidenceCommits.reduce((sum, commit) => sum + filteredSignals(commit, rule.diffSignalTypes).length, 0);
  const confidence = calculateConfidence(evidenceCommits.length, scan.commitsAnalyzed, commonFiles.length + matchedPatterns.length, signalCount);
  const validationCommands = preferredValidationCommands(scan.packageScripts);

  return {
    id: rule.id,
    name: rule.name,
    confidence,
    evidenceCommits: evidenceCommits.map((commit) => toEvidenceCommit(commit, rule.diffSignalTypes)),
    commonFiles,
    commonDirectories,
    observedConventions: rule.observedConventions(evidenceCommits),
    observedChanges: observedChanges(evidenceCommits, rule.diffSignalTypes),
    suggestedValidationCommands: validationCommands,
    matchedPatterns,
    pathSignals,
    diffSignals,
    confidenceFactors: confidenceFactors(evidenceCommits, scan.commitsAnalyzed, signalCount, validationCommands),
    falsePositiveNotes: rule.falsePositiveNotes,
    rationale: rule.rationale
  };
}

function toEvidenceCommit(commit: CommitMetadata, types?: DiffSignal["type"][]): EvidenceCommit {
  return {
    hash: commit.hash,
    shortHash: commit.shortHash,
    message: commit.message,
    changedFiles: commit.changedFiles,
    diffSignals: topDiffSignals([commit], 5, types),
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

function hasUiServerFeature(commit: CommitMetadata): boolean {
  return commit.changedFiles.includes("server/uiServer.ts") && commit.changedFiles.some((file) => UI_FILE_TERMS.test(file));
}

function hasDiffSignal(commit: CommitMetadata, type: DiffSignal["type"]): boolean {
  return commit.diffSummary.signals.some((signal) => signal.type === type);
}

function hasAnyDiffSignal(commit: CommitMetadata, types: DiffSignal["type"][]): boolean {
  const wanted = new Set(types);
  return commit.diffSummary.signals.some((signal) => wanted.has(signal.type));
}

function filesWithSignals(commit: CommitMetadata, types: DiffSignal["type"][]): string[] {
  const wanted = new Set(types);
  return unique(commit.diffSummary.signals.filter((signal) => wanted.has(signal.type)).map((signal) => signal.filePath));
}

function calculateConfidence(matchCount: number, totalCommits: number, pathSignalCount: number, diffSignalCount: number): number {
  const frequencyBoost = totalCommits === 0 ? 0 : Math.min(matchCount / totalCommits, 1) * 0.16;
  const repetitionBoost = Math.min(matchCount, 6) * 0.07;
  const pathBoost = Math.min(pathSignalCount, 8) * 0.012;
  const diffBoost = Math.min(diffSignalCount, 12) * 0.018;
  return Number(Math.min(0.95, 0.38 + repetitionBoost + frequencyBoost + pathBoost + diffBoost).toFixed(2));
}

function confidenceFactors(
  evidenceCommits: CommitMetadata[],
  totalCommits: number,
  signalCount: number,
  validationCommands: string[]
): string[] {
  const factors = [
    `${evidenceCommits.length} of ${totalCommits} scanned commits matched this rule.`,
    `${signalCount} structured diff signals were observed across the matching commits.`
  ];

  const files = topValues(evidenceCommits.flatMap((commit) => commit.changedFiles), 3);
  if (files.length > 0) {
    factors.push(`Strongest repeated files: ${formatList(files)}.`);
  }

  if (validationCommands.length > 0) {
    factors.push(`Validation commands were limited to scripts present in package.json: ${validationCommands.join(", ")}.`);
  } else {
    factors.push("No package.json validation scripts were detected.");
  }

  return factors;
}

function observedChanges(commits: CommitMetadata[], types?: DiffSignal["type"][]): string[] {
  const signals = commits.flatMap((commit) => filteredSignals(commit, types));
  const changes = [
    describeSignals("exported-symbol", "Added exported symbols", signals),
    describeSignals("test-name", "Added named tests", signals),
    describeSignals("cli-command", "Added CLI commands", signals),
    describeSignals("cli-option", "Added CLI options", signals),
    describeSignals("package-script", "Changed package scripts", signals),
    describeSignals("config-key", "Added config keys", signals),
    describeSignals("api-route", "Added routes", signals),
    describeSignals("route-handler", "Added route handlers", signals)
  ].filter((value): value is string => Boolean(value));

  if (changes.length > 0) {
    return changes;
  }

  return ["No structured diff signals were detected beyond changed paths."];
}

function describeSignals(type: DiffSignal["type"], label: string, signals: DiffSignal[]): string | undefined {
  const values = topValues(
    signals.filter((signal) => signal.type === type).map((signal) => `${signal.value} in ${signal.filePath}`),
    4
  );

  if (values.length === 0) {
    return undefined;
  }

  return `${label}: ${formatList(values)}.`;
}

function topDiffSignals(commits: CommitMetadata[], limit: number, types?: DiffSignal["type"][]): string[] {
  return topValues(
    commits.flatMap((commit) =>
      filteredSignals(commit, types).map((signal) => `${signal.type}:${signal.value} (${signal.filePath})`)
    ),
    limit
  );
}

function filteredSignals(commit: CommitMetadata, types?: DiffSignal["type"][]): DiffSignal[] {
  if (!types || types.length === 0) {
    return commit.diffSummary.signals;
  }

  const wanted = new Set(types);
  return commit.diffSummary.signals.filter((signal) => wanted.has(signal.type));
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

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function gridConventions(commits: CommitMetadata[]): string[] {
  const dirs = topValues(commits.flatMap((commit) => commit.touchedDirectories), 3);
  const conventions = [`Grid-related changes most often appear under ${formatList(dirs)}.`];

  if (touchesTests(commits)) {
    conventions.push("Grid work includes nearby test updates in the matching evidence.");
  }

  if (touchesHtmlOrStyles(commits)) {
    conventions.push("Grid behavior changes pair TypeScript updates with template or style files.");
  }

  return conventions;
}

function testConventions(commits: CommitMetadata[]): string[] {
  const files = topValues(
    commits.flatMap((commit) => commit.changedFiles).filter((file) => TEST_TERMS.test(file)),
    4
  );
  const conventions = [
    `Repeated test changes center on ${formatList(files)}.`,
    "Tests are commonly updated in the same commit as implementation work."
  ];

  const e2eTools = [
    commits.some((commit) => commit.changedFiles.some((file) => /playwright/i.test(file))) ? "Playwright" : undefined,
    commits.some((commit) => commit.changedFiles.some((file) => /cypress/i.test(file))) ? "Cypress" : undefined,
    commits.some((commit) => commit.changedFiles.some((file) => /(^|\/)e2e(\/|$)/i.test(file))) ? "e2e" : undefined
  ].filter((tool): tool is string => Boolean(tool));
  if (e2eTools.length > 0) {
    conventions.push(`${e2eTools.join(", ")} coverage appears in the matching evidence.`);
  }

  return conventions;
}

function configConventions(commits: CommitMetadata[]): string[] {
  const files = topValues(
    commits.flatMap((commit) => commit.changedFiles).filter((file) => CONFIG_TERMS.test(file)),
    5
  );
  return [
    `Runtime configuration changes recur in ${formatList(files)}.`,
    "Config work should check related package, environment, JSON, YAML, or fixture settings."
  ];
}

function angularConventions(commits: CommitMetadata[]): string[] {
  const dirs = topValues(commits.flatMap((commit) => commit.touchedDirectories), 3);
  const conventions = [
    `Angular feature work commonly stays within ${formatList(dirs)}.`,
    "Component files and service files are changed together, suggesting a feature slice pattern."
  ];

  if (touchesTests(commits)) {
    conventions.push("Feature slices include companion test updates in the matching evidence.");
  }

  return conventions;
}

function apiConventions(commits: CommitMetadata[]): string[] {
  const dirs = topValues(commits.flatMap((commit) => commit.touchedDirectories), 4);
  return [
    `Route or handler additions recur around ${formatList(dirs)}.`,
    "Endpoint-facing changes are identified from added route or handler lines, not server paths alone.",
    "When adding an endpoint, mirror the nearest route shape and its nearby tests."
  ];
}

function cliConventions(commits: CommitMetadata[]): string[] {
  const files = topValues(filesWithAnySignals(commits, ["cli-command", "cli-option"]), 4);
  return [
    `CLI command or option additions recur in ${formatList(files)}.`,
    "CLI-facing changes should update command wiring and nearby tests together when the evidence shows both."
  ];
}

function uiServerConventions(commits: CommitMetadata[]): string[] {
  const files = topValues(commits.flatMap((commit) => commit.changedFiles).filter((file) => file === "server/uiServer.ts" || UI_FILE_TERMS.test(file)), 5);
  return [
    `UI server feature work recurs around ${formatList(files)}.`,
    "server/uiServer.ts changes travel with UI implementation or UI test files in the matching evidence."
  ];
}

function productAnalysisConventions(commits: CommitMetadata[]): string[] {
  const files = topValues(commits.flatMap((commit) => commit.changedFiles).filter((file) => PRODUCT_ANALYSIS_TERMS.test(file)), 5);
  return [
    `Product analysis work recurs around ${formatList(files)}.`,
    "Critic, audit, report, heuristic, and evidence files form a repeated product-analysis feature family."
  ];
}

function filesWithAnySignals(commits: CommitMetadata[], types: DiffSignal["type"][]): string[] {
  const wanted = new Set(types);
  return commits.flatMap((commit) => commit.diffSummary.signals.filter((signal) => wanted.has(signal.type)).map((signal) => signal.filePath));
}

function touchesTests(commits: CommitMetadata[]): boolean {
  return commits.some((commit) => commit.changedFiles.some((file) => TEST_TERMS.test(file)));
}

function touchesHtmlOrStyles(commits: CommitMetadata[]): boolean {
  return commits.some((commit) => commit.changedFiles.some((file) => /\.(html|css|scss|sass|less)$/i.test(file)));
}

function formatList(values: string[]): string {
  if (values.length === 0) {
    return "the same nearby files";
  }

  return values.map((value) => {
    const normalized = value.includes("/") || value.includes(":") ? value : path.normalize(value);
    return `\`${normalized}\``;
  }).join(", ");
}
