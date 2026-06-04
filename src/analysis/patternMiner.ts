import { posix as path } from "node:path";
import type { CandidateSkill, CommitMetadata, EvidenceCommit, GenericSignal, MiningResult, ScanResult } from "../types.js";

interface WorkingCluster {
  commits: CommitMetadata[];
  signalCounts: Map<GenericSignal, number>;
  directoryCounts: Map<string, number>;
}

interface SkillNameProposal {
  name: string;
  namingConfidence: number;
  reasons: string[];
}

const MIN_CLUSTER_COMMITS = 2;

const SIGNAL_PRIORITY: GenericSignal[] = [
  "api_route_changed",
  "controller_changed",
  "service_layer_changed",
  "repository_or_dao_changed",
  "migration_changed",
  "schema_changed",
  "model_or_entity_changed",
  "query_changed",
  "queue_or_event_handler_changed",
  "background_job_changed",
  "component_changed",
  "page_or_screen_changed",
  "frontend_test_changed",
  "integration_test_changed",
  "e2e_test_changed",
  "unit_test_changed",
  "test_case_added",
  "ci_changed",
  "docker_changed",
  "terraform_or_infra_changed",
  "deployment_changed",
  "config_changed",
  "package_or_dependency_changed",
  "docs_changed",
  "cli_command_changed",
  "function_added",
  "class_added",
  "interface_or_type_added"
];

const CODE_ONLY_SIGNALS = new Set<GenericSignal>([
  "exported_symbol_added",
  "function_added",
  "class_added",
  "interface_or_type_added",
  "enum_added"
]);

export function minePatterns(scan: ScanResult): MiningResult {
  const clusters = buildClusters(scan.commits);
  const candidates = ensureUniqueCandidateIds(clusters
    .filter((cluster) => cluster.commits.length >= MIN_CLUSTER_COMMITS)
    .map((cluster, index) => buildCandidate(cluster, scan, index))
    .sort((a, b) => b.patternConfidence - a.patternConfidence || b.namingConfidence - a.namingConfidence || a.name.localeCompare(b.name)));

  return {
    repoRoot: scan.repoRoot,
    generatedAt: new Date().toISOString(),
    commitsAnalyzed: scan.commitsAnalyzed,
    candidates
  };
}

function ensureUniqueCandidateIds(candidates: CandidateSkill[]): CandidateSkill[] {
  const seen = new Map<string, number>();
  return candidates.map((candidate) => {
    const count = seen.get(candidate.id) ?? 0;
    seen.set(candidate.id, count + 1);
    if (count === 0) {
      return candidate;
    }

    return {
      ...candidate,
      id: `${candidate.id}-${count + 1}`
    };
  });
}

function buildClusters(commits: CommitMetadata[]): WorkingCluster[] {
  const clusters: WorkingCluster[] = [];

  for (const commit of commits) {
    const shape = shapeSignals(commit);
    if (shape.length === 0) {
      continue;
    }

    const match = bestCluster(shape, commit, clusters);
    if (match) {
      addCommitToCluster(match, commit);
    } else {
      clusters.push(createCluster(commit));
    }
  }

  return mergeNearDuplicateClusters(clusters);
}

function bestCluster(shape: GenericSignal[], commit: CommitMetadata, clusters: WorkingCluster[]): WorkingCluster | undefined {
  let best: { cluster: WorkingCluster; score: number } | undefined;

  for (const cluster of clusters) {
    const score = clusterSimilarity(shape, commit, cluster);
    if (score >= 0.46 && (!best || score > best.score)) {
      best = { cluster, score };
    }
  }

  return best?.cluster;
}

function clusterSimilarity(shape: GenericSignal[], commit: CommitMetadata, cluster: WorkingCluster): number {
  const clusterShape = dominantSignals(cluster, 8);
  const signalScore = jaccard(shape, clusterShape);
  const directoryScore = topDirectories([commit], 3).some((dir) => topClusterDirectories(cluster, 3).includes(dir)) ? 0.15 : 0;
  return signalScore + directoryScore;
}

function mergeNearDuplicateClusters(clusters: WorkingCluster[]): WorkingCluster[] {
  const merged: WorkingCluster[] = [];

  for (const cluster of clusters) {
    const shape = dominantSignals(cluster, 8);
    const existing = merged.find((candidate) => jaccard(shape, dominantSignals(candidate, 8)) >= 0.7);
    if (existing) {
      for (const commit of cluster.commits) {
        if (!existing.commits.some((existingCommit) => existingCommit.hash === commit.hash)) {
          addCommitToCluster(existing, commit);
        }
      }
    } else {
      merged.push(cluster);
    }
  }

  return merged;
}

function createCluster(commit: CommitMetadata): WorkingCluster {
  const cluster: WorkingCluster = {
    commits: [],
    signalCounts: new Map(),
    directoryCounts: new Map()
  };
  addCommitToCluster(cluster, commit);
  return cluster;
}

function addCommitToCluster(cluster: WorkingCluster, commit: CommitMetadata): void {
  cluster.commits.push(commit);
  for (const signal of shapeSignals(commit)) {
    cluster.signalCounts.set(signal, (cluster.signalCounts.get(signal) ?? 0) + 1);
  }
  for (const directory of commit.touchedDirectories) {
    cluster.directoryCounts.set(directory, (cluster.directoryCounts.get(directory) ?? 0) + 1);
  }
}

function buildCandidate(cluster: WorkingCluster, scan: ScanResult, index: number): CandidateSkill {
  const commits = cluster.commits;
  const dominant = dominantSignals(cluster, 10);
  const proposal = proposeSkillName(dominant, repeatedTerms(commits), frameworkHints(commits));
  const patternConfidence = calculatePatternConfidence(cluster, scan.commitsAnalyzed);
  const commonFiles = topValues(commits.flatMap((commit) => commit.changedFiles), 8);
  const commonDirectories = topDirectories(commits, 6);
  const pathSignals = topValues(commits.flatMap((commit) => commit.pathSignals), 12);
  const diffSignals = topDiffSignalLabels(commits, 12);
  const terms = repeatedTerms(commits);
  const id = uniqueSkillId(proposal.name, dominant, index);

  return {
    id,
    name: proposal.name,
    patternConfidence,
    namingConfidence: proposal.namingConfidence,
    confidence: patternConfidence,
    evidenceCommits: representativeCommits(commits, dominant).map(toEvidenceCommit),
    commonFiles,
    commonDirectories,
    observedConventions: observedConventions(dominant, commonDirectories, frameworkHints(commits)),
    observedChanges: observedChanges(commits),
    suggestedValidationCommands: scan.validationCommands,
    genericSignals: dominant,
    repeatedTerms: terms,
    frameworkHints: frameworkHints(commits),
    matchedPatterns: dominant,
    pathSignals,
    diffSignals,
    confidenceFactors: confidenceFactors(cluster, scan.commitsAnalyzed, proposal.reasons),
    falsePositiveNotes: falsePositiveNotes(dominant, commits, proposal.namingConfidence),
    rationale: `Compactor grouped ${commits.length} commits with a repeated change shape: ${dominant.join(", ")}.`
  };
}

function shapeSignals(commit: CommitMetadata): GenericSignal[] {
  const domainSignals = commit.genericSignals.filter((signal) => !CODE_ONLY_SIGNALS.has(signal));
  const source = domainSignals.length > 0 ? domainSignals : commit.genericSignals;
  return orderSignals(unique(source)).slice(0, 8);
}

function orderSignals(signals: GenericSignal[]): GenericSignal[] {
  const priority = new Map(SIGNAL_PRIORITY.map((signal, index) => [signal, index]));
  return [...signals].sort((a, b) => (priority.get(a) ?? 999) - (priority.get(b) ?? 999) || a.localeCompare(b));
}

function dominantSignals(cluster: WorkingCluster, limit: number): GenericSignal[] {
  return [...cluster.signalCounts.entries()]
    .sort((a, b) => b[1] - a[1] || (SIGNAL_PRIORITY.indexOf(a[0]) + 1 || 999) - (SIGNAL_PRIORITY.indexOf(b[0]) + 1 || 999) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([signal]) => signal);
}

function proposeSkillName(signals: GenericSignal[], terms: string[], frameworks: string[]): SkillNameProposal {
  const has = (signal: GenericSignal) => signals.includes(signal);
  const hasAny = (values: GenericSignal[]) => values.some(has);
  const withReason = (name: string, confidence: number, reasons: string[]): SkillNameProposal => ({
    name,
    namingConfidence: confidence,
    reasons
  });

  if (has("api_route_changed") && has("service_layer_changed") && hasAny(["unit_test_changed", "integration_test_changed", "e2e_test_changed", "test_case_added"])) {
    return withReason("Add or Update Backend API Feature", 0.92, ["route, service, and test signals were dominant"]);
  }
  if (has("api_route_changed")) {
    return withReason("Add or Update Backend API Feature", 0.86, ["route or handler signals were visible in diffs"]);
  }
  if (has("migration_changed") && has("model_or_entity_changed") && hasAny(["unit_test_changed", "integration_test_changed", "test_case_added"])) {
    return withReason("Add or Update Database-Backed Feature", 0.9, ["migration, model/entity, and test signals were dominant"]);
  }
  if (has("schema_changed") && has("query_changed")) {
    return withReason("Update Database Schema and Queries", 0.88, ["schema and query signals repeated together"]);
  }
  if (has("queue_or_event_handler_changed") && hasAsyncEvidence(terms, frameworks)) {
    return withReason("Add or Update Async Job/Event Handler", 0.86, ["queue, event, job, worker, consumer, or subscriber evidence was dominant"]);
  }
  if (has("component_changed") && hasAny(["frontend_test_changed", "unit_test_changed", "test_case_added"])) {
    return withReason("Add or Update UI Component Feature", 0.88, ["component and frontend/test signals repeated together"]);
  }
  if (has("ci_changed") && has("config_changed")) {
    return withReason("Update Build or CI Configuration", 0.86, ["CI and configuration signals repeated together"]);
  }
  if (hasAny(["ui_changed", "component_changed", "page_or_screen_changed"]) && has("backend_changed")) {
    return withReason("Update Full-Stack Feature Pattern", 0.78, ["frontend and backend signals repeated together"]);
  }
  if (has("backend_changed") && has("db_changed") && hasAny(["unit_test_changed", "integration_test_changed", "test_case_added"])) {
    return withReason("Update Backend and Database Feature", 0.78, ["backend, database, and test signals repeated together"]);
  }
  if (has("backend_changed") && hasAny(["unit_test_changed", "integration_test_changed", "test_case_added"])) {
    return withReason("Update Backend and Test Pattern", 0.7, ["backend and test signals repeated together"]);
  }
  if (has("db_changed")) {
    return withReason("Update Database Change Pattern", 0.68, ["database signals were dominant"]);
  }
  if (hasAny(["ui_changed", "component_changed", "page_or_screen_changed"])) {
    return withReason("Update Frontend Change Pattern", 0.66, ["frontend/UI signals were dominant"]);
  }
  if (hasAny(["config_changed", "package_or_dependency_changed", "docker_changed", "terraform_or_infra_changed", "deployment_changed"])) {
    return withReason("Update Configuration or Infrastructure Pattern", 0.66, ["configuration or infrastructure signals were dominant"]);
  }
  if (has("docs_changed")) {
    return withReason("Update Documentation Pattern", 0.64, ["documentation signals were dominant"]);
  }
  if (terms.length > 0 || frameworks.length > 0) {
    return withReason("Update Repeated Engineering Pattern", 0.52, ["repeated terms or framework hints were present, but semantic signal confidence was modest"]);
  }
  return withReason("Update Full-Stack Feature Pattern", 0.42, ["signal evidence was repeated but semantically broad"]);
}

function hasAsyncEvidence(terms: string[], frameworks: string[]): boolean {
  return [...terms, ...frameworks].some((value) => /(queue|event|job|worker|task|consumer|subscriber|listener|scheduler|async)/i.test(value));
}

function calculatePatternConfidence(cluster: WorkingCluster, totalCommits: number): number {
  const matchCount = cluster.commits.length;
  const topSignalConsistency = Math.max(...[...cluster.signalCounts.values()]) / matchCount;
  const topDirectoryConsistency = Math.max(...[...cluster.directoryCounts.values()]) / matchCount;
  const frequency = totalCommits === 0 ? 0 : Math.min(matchCount / totalCommits, 1);
  return Number(Math.min(0.97, 0.28 + Math.min(matchCount, 8) * 0.055 + topSignalConsistency * 0.18 + topDirectoryConsistency * 0.12 + frequency * 0.12).toFixed(2));
}

function confidenceFactors(cluster: WorkingCluster, totalCommits: number, namingReasons: string[]): string[] {
  const commits = cluster.commits;
  const dominant = dominantSignals(cluster, 6);
  return [
    `${commits.length} of ${totalCommits} scanned commits matched this repeated change shape.`,
    `Dominant generic signals: ${dominant.join(", ")}.`,
    `Most common directories: ${topClusterDirectories(cluster, 4).join(", ") || "mixed directories"}.`,
    ...namingReasons
  ];
}

function observedConventions(signals: GenericSignal[], directories: string[], frameworks: string[]): string[] {
  const conventions = [`Repeated changes combine these generic signals: ${signals.slice(0, 8).join(", ")}.`];
  if (directories.length > 0) conventions.push(`Most matching files are under ${formatList(directories.slice(0, 4))}.`);
  if (frameworks.length > 0) conventions.push(`Framework or language hints observed: ${frameworks.slice(0, 5).join(", ")}.`);
  return conventions;
}

function observedChanges(commits: CommitMetadata[]): string[] {
  const labels = topDiffSignalLabels(commits, 8);
  if (labels.length === 0) {
    return ["No structured diff-level changes were detected beyond path signals."];
  }
  return labels.map((label) => `Observed ${label}.`);
}

function falsePositiveNotes(signals: GenericSignal[], commits: CommitMetadata[], namingConfidence: number): string[] {
  const notes: string[] = [];
  const diffSignalCount = commits.reduce((sum, commit) => sum + commit.diffSummary.signals.length, 0);
  if (diffSignalCount === 0) notes.push("This cluster is path-based only; review before promoting it to a reusable skill.");
  if (namingConfidence < 0.7) notes.push("Naming confidence is modest because the dominant signals are broad.");
  if (signals.every((signal) => signal.includes("test") || signal === "test_case_added")) notes.push("This may be a test-maintenance pattern rather than a feature workflow.");
  if (signals.includes("backend_changed") && !signals.includes("api_route_changed")) notes.push("Backend-related does not mean API endpoint; no route signal was required for this name.");
  return notes.length > 0 ? notes : ["Review representative commits to confirm the proposed skill scope before adopting it."];
}

function toEvidenceCommit(commit: CommitMetadata): EvidenceCommit {
  return {
    hash: commit.hash,
    shortHash: commit.shortHash,
    message: commit.message,
    changedFiles: commit.changedFiles,
    diffSignals: commit.diffSummary.signals.slice(0, 6).map((signal) => `${signal.type}:${signal.value} (${signal.filePath})`),
    pathSignals: commit.pathSignals.slice(0, 8),
    url: commit.commitUrl
  };
}

function representativeCommits(commits: CommitMetadata[], dominantSignals: GenericSignal[]): CommitMetadata[] {
  const dominant = new Set(dominantSignals);
  return [...commits].sort((a, b) => {
    const aScore = a.genericSignals.filter((signal) => dominant.has(signal)).length + a.diffSummary.signals.length * 0.01;
    const bScore = b.genericSignals.filter((signal) => dominant.has(signal)).length + b.diffSummary.signals.length * 0.01;
    return bScore - aScore;
  });
}

function repeatedTerms(commits: CommitMetadata[]): string[] {
  return topValues(commits.flatMap((commit) => [...commit.filenameTerms, ...commit.messageTerms]), 10);
}

function frameworkHints(commits: CommitMetadata[]): string[] {
  return topValues(commits.flatMap((commit) => commit.frameworkHints), 8);
}

function topDiffSignalLabels(commits: CommitMetadata[], limit: number): string[] {
  return topValues(
    commits.flatMap((commit) => commit.diffSummary.signals.map((signal) => `${signal.type}:${signal.value} (${signal.filePath})`)),
    limit
  );
}

function topDirectories(commits: CommitMetadata[], limit: number): string[] {
  return topValues(commits.flatMap((commit) => commit.touchedDirectories), limit);
}

function topClusterDirectories(cluster: WorkingCluster, limit: number): string[] {
  return [...cluster.directoryCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([directory]) => directory);
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

function jaccard<T>(left: T[], right: T[]): number {
  const a = new Set(left);
  const b = new Set(right);
  const intersection = [...a].filter((value) => b.has(value)).length;
  const union = new Set([...a, ...b]).size || 1;
  return intersection / union;
}

function uniqueSkillId(name: string, signals: GenericSignal[], index: number): string {
  const base = slug(name);
  const suffix = signals.slice(0, 2).map(slug).join("-");
  return suffix ? `${base}-${suffix}` : `${base}-${index + 1}`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function formatList(values: string[]): string {
  return values.map((value) => `\`${path.normalize(value)}\``).join(", ");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}
