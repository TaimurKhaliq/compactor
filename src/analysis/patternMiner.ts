import { posix as path } from "node:path";
import { emptyRoleCounts, inferFileRole, learnRepositoryPatterns } from "./repoLearning.js";
import { discoverValidationCommandsForFiles } from "../git/packageScripts.js";
import type { CandidateSkill, CommitMetadata, DiffSignal, EvidenceCommit, FileRoleCounts, GenericSignal, LearnedSurface, MiningResult, RepoLearning, ScanResult } from "../types.js";

interface WorkingCluster {
  commits: CommitMetadata[];
  signalCounts: Map<GenericSignal, number>;
  directoryCounts: Map<string, number>;
  surfaceCounts: Map<string, number>;
}

interface SkillNameProposal {
  name: string;
  namingConfidence: number;
  genericCategory: string;
  genericFallbackName: string;
  domainTerms: string[];
  rejectedNoisyTerms: string[];
  reasons: string[];
}

interface DomainTermEvidence {
  selected: string[];
  rejectedNoisy: string[];
  repeated: string[];
  strength: number;
}

type PrimaryArea = CandidateSkill["primaryArea"];

interface PromotionDecision {
  outputType: CandidateSkill["outputType"];
  promotionLevel: CandidateSkill["promotion_level"];
  primaryArea: PrimaryArea;
  primaryAreaShare: number;
  workflowQuality: number;
  generatedArtifactEvidenceShare: number;
  reasons: string[];
  reviewNotes: string[];
}

interface DuplicateHandlingSummary {
  mergedDuplicateDrafts: number;
  suppressedDuplicateDrafts: number;
}

interface TaskEvidenceSupport {
  hasTaskSourceEvidence: boolean;
  hasTestOrValidationSignal: boolean;
}

type LearnedSurfaceMatch = NonNullable<CandidateSkill["learnedSurface"]>;

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

const NOISY_NAMING_TERMS = new Set([
  "add",
  "added",
  "adds",
  "update",
  "updated",
  "updates",
  "fix",
  "fixed",
  "fixes",
  "improve",
  "improved",
  "improves",
  "refactor",
  "refactored",
  "action",
  "actions",
  "all",
  "change",
  "changes",
  "support",
  "compatible",
  "compatibility",
  "aicompatible",
  "repo",
  "root",
  "workspace",
  "workspaces",
  "project",
  "projects",
  "app",
  "apps",
  "error",
  "errors",
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "use",
  "using",
  "without",
  "this",
  "that",
  "build",
  "built",
  "create",
  "creates",
  "created",
  "delete",
  "deleted",
  "remove",
  "removed",
  "save",
  "saved",
  "saves",
  "load",
  "loaded",
  "run",
  "runs",
  "running",
  "fetch",
  "fetched",
  "get",
  "set",
  "post",
  "put",
  "patch",
  "render",
  "rendered",
  "renders",
  "return",
  "returns",
  "should",
  "file",
  "files",
  "test",
  "tests",
  "unit",
  "integration",
  "e2e",
  "spec",
  "src",
  "index",
  "utils",
  "util",
  "helper",
  "helpers",
  "fixture",
  "fixtures",
  "generated",
  "snapshot",
  "snapshots",
  "baseline",
  "baselines",
  "replay",
  "coverage",
  "dist",
  "expected",
  "actual",
  "json",
  "component",
  "components",
  "service",
  "services",
  "controller",
  "controllers",
  "repository",
  "repositories",
  "route",
  "routes",
  "model",
  "models",
  "entity",
  "entities",
  "migration",
  "migrations",
  "schema",
  "persistence",
  "persist",
  "config",
  "configuration",
  "pattern",
  "feature",
  "backend",
  "frontend",
  "server",
  "client",
  "web",
  "ui",
  "lib",
  "core",
  "common",
  "shared",
  "public",
  "database",
  "docs",
  "readme",
  "function",
  "class",
  "interface",
  "type",
  "cli",
  "command",
  "commands",
  "option",
  "options",
  "flag",
  "flags",
  "page",
  "pages",
  "screen",
  "screens",
  "view",
  "views"
]);

const NOISY_EVIDENCE_FILE_PATTERNS = [
  /(^|\/)(fixtures?|reports?|replay|baselines?|snapshots?|coverage|dist|build|generated)(\/|$)/i,
  /(^|\/)package-lock\.json$/i,
  /(^|\/)repo_learning_state\.json$/i,
  /\.expected\.json$/i,
  /\.report\.json$/i
];

const AGENT_READY_PATTERN_CONFIDENCE = 0.85;
const AGENT_READY_NAMING_CONFIDENCE = 0.8;
const AGENT_READY_PRIMARY_AREA_SHARE = 0.7;
const AGENT_READY_MAX_ARTIFACT_SHARE = 0.25;
const AGENT_READY_WORKFLOW_QUALITY = 0.75;
const DRAFT_PATTERN_CONFIDENCE = 0.7;
const DRAFT_NAMING_CONFIDENCE = 0.65;
const DRAFT_PRIMARY_AREA_SHARE = 0.45;
const DRAFT_MAX_ARTIFACT_SHARE = 0.4;
const DRAFT_WORKFLOW_QUALITY = 0.5;
const DRAFT_MIN_REPRESENTATIVE_FILES = 3;
const DRAFT_MIN_EVIDENCE_COMMITS = 3;

export function minePatterns(scan: ScanResult): MiningResult {
  const repoLearning = scan.repoLearning ?? learnRepositoryPatterns(scan);
  const clusters = buildClusters(scan.commits, repoLearning);
  const mined = clusters
    .filter((cluster) => cluster.commits.length >= MIN_CLUSTER_COMMITS)
    .map((cluster, index) => buildCandidate(cluster, { ...scan, repoLearning }, index))
    .sort((a, b) => b.patternConfidence - a.patternConfidence || b.namingConfidence - a.namingConfidence || a.name.localeCompare(b.name));
  const deduped = dedupePromotedDrafts(mined);
  const candidates = ensureUniqueCandidateIds(deduped.candidates);

  return {
    repoRoot: scan.repoRoot,
    generatedAt: new Date().toISOString(),
    commitsAnalyzed: scan.commitsAnalyzed,
    candidates,
    duplicateHandling: deduped.summary
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

function dedupePromotedDrafts(candidates: CandidateSkill[]): { candidates: CandidateSkill[]; summary: DuplicateHandlingSummary } {
  const summary: DuplicateHandlingSummary = {
    mergedDuplicateDrafts: 0,
    suppressedDuplicateDrafts: 0
  };
  const agentReady = candidates.filter((candidate) => candidate.promotion_level === "agent_ready").map(cloneCandidate);
  const drafts = candidates.filter((candidate) => candidate.promotion_level === "draft").map(cloneCandidate);
  const patterns = candidates.filter((candidate) => candidate.promotion_level === "pattern_candidate");
  const keptDrafts: CandidateSkill[] = [];

  for (const draft of drafts) {
    const sameNameAgent = agentReady.find((candidate) => normalizedSkillName(candidate.name) === normalizedSkillName(draft.name));
    if (sameNameAgent) {
      summary.suppressedDuplicateDrafts += 1;
      continue;
    }

    const overlappingAgent = agentReady.find((candidate) => stronglyOverlaps(candidate, draft));
    if (overlappingAgent) {
      mergeCandidateEvidence(overlappingAgent, draft);
      summary.mergedDuplicateDrafts += 1;
      continue;
    }

    const sameNameDraft = keptDrafts.find((candidate) => normalizedSkillName(candidate.name) === normalizedSkillName(draft.name));
    if (sameNameDraft) {
      mergeCandidateEvidence(sameNameDraft, draft);
      summary.mergedDuplicateDrafts += 1;
      continue;
    }

    const overlappingDraft = keptDrafts.find((candidate) => stronglyOverlaps(candidate, draft));
    if (overlappingDraft) {
      mergeCandidateEvidence(overlappingDraft, draft);
      summary.mergedDuplicateDrafts += 1;
      continue;
    }

    keptDrafts.push(draft);
  }

  return {
    candidates: [...agentReady, ...keptDrafts, ...patterns]
      .sort((a, b) => tierSort(a) - tierSort(b) || b.patternConfidence - a.patternConfidence || b.namingConfidence - a.namingConfidence || a.name.localeCompare(b.name)),
    summary
  };
}

function cloneCandidate(candidate: CandidateSkill): CandidateSkill {
  return {
    ...candidate,
    evidenceCommits: candidate.evidenceCommits.map((commit) => ({ ...commit, changedFiles: [...commit.changedFiles], diffSignals: [...commit.diffSignals], pathSignals: [...commit.pathSignals] })),
    commonFiles: [...candidate.commonFiles],
    commonDirectories: [...candidate.commonDirectories],
    observedConventions: [...candidate.observedConventions],
    observedChanges: [...candidate.observedChanges],
    suggestedValidationCommands: [...candidate.suggestedValidationCommands],
    genericSignals: [...candidate.genericSignals],
    repeatedTerms: [...candidate.repeatedTerms],
    domainTerms: [...candidate.domainTerms],
    rejectedNoisyTerms: [...candidate.rejectedNoisyTerms],
    namingReasons: [...candidate.namingReasons],
    frameworkHints: [...candidate.frameworkHints],
    matchedPatterns: [...candidate.matchedPatterns],
    pathSignals: [...candidate.pathSignals],
    diffSignals: [...candidate.diffSignals],
    confidenceFactors: [...candidate.confidenceFactors],
    falsePositiveNotes: [...candidate.falsePositiveNotes],
    promotionReasons: [...candidate.promotionReasons],
    reviewNotes: [...candidate.reviewNotes]
  };
}

function mergeCandidateEvidence(target: CandidateSkill, source: CandidateSkill): void {
  target.evidenceCommits = mergeEvidenceCommits(target.evidenceCommits, source.evidenceCommits);
  target.commonFiles = unique([...target.commonFiles, ...source.commonFiles, ...source.evidenceCommits.flatMap((commit) => commit.changedFiles)]).slice(0, 12);
  target.commonDirectories = unique([...target.commonDirectories, ...source.commonDirectories]).slice(0, 8);
  target.observedChanges = unique([...target.observedChanges, ...source.observedChanges]).slice(0, 12);
  target.suggestedValidationCommands = unique([...target.suggestedValidationCommands, ...source.suggestedValidationCommands]);
  target.repeatedTerms = unique([...target.repeatedTerms, ...source.repeatedTerms]).slice(0, 12);
  target.domainTerms = unique([...target.domainTerms, ...source.domainTerms]).slice(0, 6);
  target.pathSignals = unique([...target.pathSignals, ...source.pathSignals]).slice(0, 12);
  target.diffSignals = unique([...target.diffSignals, ...source.diffSignals]).slice(0, 12);
  target.confidenceFactors = unique([
    ...target.confidenceFactors,
    `Merged duplicate draft evidence from ${source.evidenceCommits.length} additional commits.`
  ]).slice(0, 12);
  target.falsePositiveNotes = unique([...target.falsePositiveNotes, ...source.falsePositiveNotes]).slice(0, 8);
}

function mergeEvidenceCommits(left: EvidenceCommit[], right: EvidenceCommit[]): EvidenceCommit[] {
  const seen = new Set<string>();
  const merged: EvidenceCommit[] = [];
  for (const commit of [...left, ...right]) {
    const key = commit.hash || commit.shortHash;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(commit);
  }
  return merged;
}

function stronglyOverlaps(left: CandidateSkill, right: CandidateSkill): boolean {
  const fileOverlap = jaccard([...candidateFileSet(left)], [...candidateFileSet(right)]);
  const commitOverlap = jaccard(left.evidenceCommits.map((commit) => commit.hash), right.evidenceCommits.map((commit) => commit.hash));
  return fileOverlap >= 0.5 || commitOverlap >= 0.4;
}

function candidateFileSet(candidate: CandidateSkill): Set<string> {
  return new Set([
    ...candidate.commonFiles,
    ...candidate.evidenceCommits.flatMap((commit) => commit.changedFiles)
  ].map((file) => path.normalize(file)));
}

function normalizedSkillName(name: string): string {
  return slug(name);
}

function tierSort(candidate: CandidateSkill): number {
  if (candidate.promotion_level === "agent_ready") return 0;
  if (candidate.promotion_level === "draft") return 1;
  return 2;
}

function buildClusters(commits: CommitMetadata[], repoLearning: RepoLearning): WorkingCluster[] {
  const clusters: WorkingCluster[] = [];

  for (const commit of commits) {
    const shape = shapeSignals(commit);
    const surfaceIds = surfaceIdsForCommit(repoLearning, commit);
    if (shape.length === 0 && surfaceIds.length === 0) {
      continue;
    }

    const match = bestCluster(shape, surfaceIds, commit, clusters);
    if (match) {
      addCommitToCluster(match, commit, surfaceIds);
    } else {
      clusters.push(createCluster(commit, surfaceIds));
    }
  }

  return mergeNearDuplicateClusters(clusters);
}

function bestCluster(shape: GenericSignal[], surfaceIds: string[], commit: CommitMetadata, clusters: WorkingCluster[]): WorkingCluster | undefined {
  let best: { cluster: WorkingCluster; score: number } | undefined;

  for (const cluster of clusters) {
    const score = clusterSimilarity(shape, surfaceIds, commit, cluster);
    if (score >= 0.46 && (!best || score > best.score)) {
      best = { cluster, score };
    }
  }

  return best?.cluster;
}

function clusterSimilarity(shape: GenericSignal[], surfaceIds: string[], commit: CommitMetadata, cluster: WorkingCluster): number {
  const clusterShape = dominantSignals(cluster, 8);
  const signalScore = shape.length === 0 && clusterShape.length === 0 ? 0 : jaccard(shape, clusterShape);
  const surfaceScore = surfaceIds.some((surfaceId) => cluster.surfaceCounts.has(surfaceId)) ? 0.45 : 0;
  const directoryScore = topDirectories([commit], 3).some((dir) => topClusterDirectories(cluster, 3).includes(dir)) ? 0.15 : 0;
  return signalScore + surfaceScore + directoryScore;
}

function mergeNearDuplicateClusters(clusters: WorkingCluster[]): WorkingCluster[] {
  const merged: WorkingCluster[] = [];

  for (const cluster of clusters) {
    const shape = dominantSignals(cluster, 8);
    const surfaces = dominantSurfaceIds(cluster, 4);
    const existing = merged.find((candidate) => jaccard(shape, dominantSignals(candidate, 8)) >= 0.7 || jaccard(surfaces, dominantSurfaceIds(candidate, 4)) >= 0.7);
    if (existing) {
      for (const commit of cluster.commits) {
        if (!existing.commits.some((existingCommit) => existingCommit.hash === commit.hash)) {
          addCommitToCluster(existing, commit, dominantSurfaceIds(cluster, 6));
        }
      }
    } else {
      merged.push(cluster);
    }
  }

  return merged;
}

function createCluster(commit: CommitMetadata, surfaceIds: string[]): WorkingCluster {
  const cluster: WorkingCluster = {
    commits: [],
    signalCounts: new Map(),
    directoryCounts: new Map(),
    surfaceCounts: new Map()
  };
  addCommitToCluster(cluster, commit, surfaceIds);
  return cluster;
}

function addCommitToCluster(cluster: WorkingCluster, commit: CommitMetadata, surfaceIds: string[] = []): void {
  cluster.commits.push(commit);
  for (const signal of shapeSignals(commit)) {
    cluster.signalCounts.set(signal, (cluster.signalCounts.get(signal) ?? 0) + 1);
  }
  for (const directory of commit.touchedDirectories) {
    cluster.directoryCounts.set(directory, (cluster.directoryCounts.get(directory) ?? 0) + 1);
  }
  for (const surfaceId of surfaceIds) {
    cluster.surfaceCounts.set(surfaceId, (cluster.surfaceCounts.get(surfaceId) ?? 0) + 1);
  }
}

function surfaceIdsForCommit(repoLearning: RepoLearning, commit: CommitMetadata): string[] {
  const files = commit.changedFiles.map((file) => path.normalize(file));
  return repoLearning.surfaces
    .filter((surface) => files.some((file) => fileBelongsToSurface(file, surface)))
    .map((surface) => surface.id);
}

function fileBelongsToSurface(filePath: string, surface: LearnedSurface): boolean {
  const normalized = path.normalize(filePath);
  return normalized === surface.commonDirectory ||
    normalized.startsWith(`${surface.commonDirectory}/`) ||
    surface.representativeFiles.includes(normalized) ||
    surface.coChangingTestFiles.includes(normalized) ||
    surface.coChangingConfigOrDocsFiles.includes(normalized) ||
    surfaceCoChangeFiles(surface).includes(normalized);
}

function matchLearnedSurface(repoLearning: RepoLearning, commits: CommitMetadata[], evidenceFiles: string[]): LearnedSurfaceMatch | undefined {
  const candidates = repoLearning.surfaces
    .map((surface) => surfaceMatchScore(surface, commits, evidenceFiles))
    .filter((match): match is LearnedSurfaceMatch => Boolean(match))
    .sort((a, b) => b.confidence - a.confidence || b.matchShare - a.matchShare || a.commonDirectory.localeCompare(b.commonDirectory));

  return candidates[0];
}

function surfaceMatchScore(surface: LearnedSurface, commits: CommitMetadata[], evidenceFiles: string[]): LearnedSurfaceMatch | undefined {
  const matchingCommits = commits.filter((commit) => commit.changedFiles.some((file) => fileBelongsToSurface(file, surface)));
  const matchShare = commits.length === 0 ? 0 : matchingCommits.length / commits.length;
  const usefulFiles = unique(evidenceFiles.map((file) => path.normalize(file)));
  const surfaceFiles = new Set([
    ...surface.representativeFiles,
    ...surface.coChangingTestFiles,
    ...surface.coChangingConfigOrDocsFiles
  ]);
  const overlap = usefulFiles.filter((file) => surfaceFiles.has(file) || fileBelongsToSurface(file, surface)).length;
  const overlapShare = usefulFiles.length === 0 ? 0 : overlap / usefulFiles.length;
  const sourceEvidence = usefulFiles.filter((file) => inferFileRole(file) === "source" && fileBelongsToSurface(file, surface));

  if (matchShare < 0.4 || sourceEvidence.length === 0) {
    return undefined;
  }

  const confidence = Number(Math.min(0.98, surface.confidence * 0.42 + matchShare * 0.34 + overlapShare * 0.16 + (surface.coChangingTestFiles.length > 0 ? 0.05 : 0) + (surface.validationCommands.length > 0 ? 0.03 : 0)).toFixed(2));
  const roleCounts = roleCountsForFiles(usefulFiles);

  return {
    id: surface.id,
    displayName: surface.displayName,
    commonDirectory: surface.commonDirectory,
    confidence,
    matchShare: Number(matchShare.toFixed(2)),
    representativeFiles: surface.representativeFiles,
    coChangingTestFiles: surface.coChangingTestFiles,
    coChangingConfigOrDocsFiles: surface.coChangingConfigOrDocsFiles,
    validationCommands: surface.validationCommands,
    repeatedTerms: surface.repeatedTerms,
    coChangeEvidence: surface.coChangeEvidence,
    roleCounts,
    reasons: [
      `${matchingCommits.length} of ${commits.length} evidence commits touched this surface.`,
      `${sourceEvidence.length} source evidence files matched ${surface.commonDirectory}.`,
      surface.coChangingTestFiles.length > 0
        ? `${surface.coChangingTestFiles.length} tests repeatedly co-changed with this surface.`
        : "No repeatedly co-changing tests were learned for this surface.",
      surface.validationCommands.length > 0
        ? `Validation commands were discovered near the surface: ${surface.validationCommands.join(", ")}.`
        : "No validation command was discovered near this surface."
    ]
  };
}

function roleCountsForFiles(files: string[]): FileRoleCounts {
  const counts = emptyRoleCounts();
  for (const file of files) {
    counts[inferFileRole(file)] += 1;
  }
  return counts;
}

function buildCandidate(cluster: WorkingCluster, scan: ScanResult, index: number): CandidateSkill {
  const commits = cluster.commits;
  const dominant = dominantSignals(cluster, 10);
  const evidenceFiles = filteredEvidenceFiles(commits);
  const repoLearning = scan.repoLearning ?? learnRepositoryPatterns(scan);
  const learnedSurface = matchLearnedSurface(repoLearning, commits, evidenceFiles);
  const termEvidence = refineDomainTermEvidence(computeDomainTermEvidence(commits, scan), commits, dominant);
  const proposal = proposeSkillName(dominant, termEvidence, frameworkHints(commits));
  const patternConfidence = calculatePatternConfidence(cluster, scan.commitsAnalyzed);
  const commonFiles = topValues(evidenceFiles, 8);
  const commonDirectories = topValues(evidenceFiles.map((file) => path.dirname(file) === "." ? "repo root" : path.dirname(file)), 6);
  const pathSignals = topValues(commits.flatMap((commit) => commit.pathSignals), 12);
  const diffSignals = topDiffSignalLabels(commits, 12);
  const terms = unique([...termEvidence.repeated, ...(learnedSurface?.repeatedTerms ?? [])]);
  const validationCommands = unique([
    ...(learnedSurface?.validationCommands ?? []),
    ...discoverValidationCommandsForFiles(scan.repoRoot, unique([...commonFiles, ...(learnedSurface?.representativeFiles ?? []), ...(learnedSurface?.coChangingTestFiles ?? [])]))
  ]);
  const taskEvidenceFiles = unique(evidenceFiles);
  const taskArea = effectiveTaskArea(commits, dominant, taskEvidenceFiles);
  const artifactShare = generatedArtifactEvidenceShare(commits);
  const taskName = generateTaskSkillName(taskArea, dominant, taskEvidenceFiles, proposal.domainTerms, proposal.genericCategory, learnedSurface);
  const namingAdjustment = adjustedNamingConfidence(proposal.namingConfidence, commits, dominant, taskEvidenceFiles, taskArea, proposal.genericCategory, validationCommands, artifactShare, taskName, proposal.domainTerms, learnedSurface);
  const promotion = decidePromotion(
    commits,
    dominant,
    taskEvidenceFiles,
    patternConfidence,
    namingAdjustment.confidence,
    proposal.genericCategory,
    terms,
    validationCommands,
    taskName,
    taskArea,
    learnedSurface
  );
  const namingConfidence = finalNamingConfidence(namingAdjustment.confidence, promotion);
  const candidateName = promotion.promotionLevel === "pattern_candidate"
    ? neutralPatternCandidateName(dominant, promotion.primaryArea, promotion.primaryAreaShare, termEvidence.selected, proposal.genericCategory)
    : taskName;
  const id = uniqueSkillId(candidateName, dominant, index);

  return {
    id,
    name: candidateName,
    taskDescription: generateTaskDescription(candidateName, promotion.primaryArea, commits, dominant, taskEvidenceFiles, proposal.domainTerms, proposal.genericCategory, learnedSurface),
    outputType: promotion.outputType,
    promotion_level: promotion.promotionLevel,
    primaryArea: promotion.primaryArea,
    primaryAreaShare: promotion.primaryAreaShare,
    workflowQuality: promotion.workflowQuality,
    generatedArtifactEvidenceShare: promotion.generatedArtifactEvidenceShare,
    promotionReasons: promotion.reasons,
    reviewNotes: promotion.reviewNotes,
    patternConfidence,
    namingConfidence,
    confidence: patternConfidence,
    evidenceCommits: representativeCommits(commits, dominant).map(toEvidenceCommit),
    commonFiles,
    commonDirectories,
    observedConventions: observedConventions(dominant, commonDirectories, frameworkHints(commits)),
    observedChanges: observedChanges(commits),
    suggestedValidationCommands: validationCommands,
    genericSignals: dominant,
    repeatedTerms: terms,
    domainTerms: proposal.domainTerms,
    rejectedNoisyTerms: proposal.rejectedNoisyTerms,
    genericCategory: proposal.genericCategory,
    genericFallbackName: proposal.genericFallbackName,
    namingReasons: [...proposal.reasons, ...namingAdjustment.reasons],
    frameworkHints: frameworkHints(commits),
    matchedPatterns: dominant,
    pathSignals,
    diffSignals,
    confidenceFactors: confidenceFactors(cluster, scan.commitsAnalyzed, [...proposal.reasons, ...namingAdjustment.reasons], learnedSurface),
    falsePositiveNotes: falsePositiveNotes(dominant, commits, namingConfidence),
    rationale: learnedSurface
      ? `Compactor grouped ${commits.length} commits around learned surface ${learnedSurface.displayName} (${learnedSurface.commonDirectory}) with repeated change shape: ${dominant.join(", ") || "source/test co-change"}.`
      : `Compactor grouped ${commits.length} commits with a repeated change shape: ${dominant.join(", ")}.`,
    learnedSurface
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

function dominantSurfaceIds(cluster: WorkingCluster, limit: number): string[] {
  return [...cluster.surfaceCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([surfaceId]) => surfaceId);
}

function proposeSkillName(signals: GenericSignal[], termEvidence: DomainTermEvidence, frameworks: string[]): SkillNameProposal {
  const has = (signal: GenericSignal) => signals.includes(signal);
  const hasAny = (values: GenericSignal[]) => values.some(has);
  const withCategory = (genericCategory: string, fallbackName: string, baseConfidence: number, reasons: string[]): SkillNameProposal => {
    const domainPhrase = buildDomainPhrase(termEvidence.selected);
    const hasDomainPhrase = domainPhrase.length > 0;
    const namingConfidence = Number(
      Math.min(0.97, baseConfidence + (hasDomainPhrase ? Math.min(0.14, termEvidence.strength * 0.16) : 0)).toFixed(2)
    );

    return {
      name: hasDomainPhrase ? `Add or Update ${domainPhrase} ${genericCategory}` : fallbackName,
      namingConfidence,
      genericCategory,
      genericFallbackName: fallbackName,
      domainTerms: termEvidence.selected,
      rejectedNoisyTerms: termEvidence.rejectedNoisy,
      reasons: [
        ...reasons,
        hasDomainPhrase
          ? `domain terms used for name: ${termEvidence.selected.join(", ")}`
          : `generic fallback used: ${fallbackName}`,
        termEvidence.rejectedNoisy.length > 0
          ? `rejected noisy terms: ${termEvidence.rejectedNoisy.slice(0, 8).join(", ")}`
          : "no noisy naming terms dominated the evidence"
      ]
    };
  };

  const withReason = (name: string, confidence: number, reasons: string[]): SkillNameProposal => ({
    name,
    namingConfidence: confidence,
    genericCategory: name.replace(/^Add or Update /, "").replace(/^Update /, ""),
    genericFallbackName: name,
    domainTerms: [],
    rejectedNoisyTerms: termEvidence.rejectedNoisy,
    reasons
  });

  if (has("api_route_changed") && has("service_layer_changed") && hasAny(["unit_test_changed", "integration_test_changed", "e2e_test_changed", "test_case_added"])) {
    return withCategory("Backend API Feature", "Add or Update Backend API Feature", 0.82, ["route, service, and test signals were dominant"]);
  }
  if (has("api_route_changed")) {
    return withCategory("Backend API Feature", "Add or Update Backend API Feature", 0.78, ["route or handler signals were visible in diffs"]);
  }
  if (has("migration_changed") && has("model_or_entity_changed") && hasAny(["unit_test_changed", "integration_test_changed", "test_case_added"])) {
    return withCategory("Database-Backed Feature", "Add or Update Database-Backed Feature", 0.82, ["migration, model/entity, and test signals were dominant"]);
  }
  if (has("schema_changed") && has("query_changed")) {
    return withCategory("Database Schema and Query Pattern", "Update Database Schema and Queries", 0.8, ["schema and query signals repeated together"]);
  }
  if (has("queue_or_event_handler_changed") && hasAsyncEvidence(termEvidence.repeated, frameworks)) {
    return withCategory("Async Job/Event Handler", "Add or Update Async Job/Event Handler", 0.78, ["queue, event, job, worker, consumer, or subscriber evidence was dominant"]);
  }
  if (has("component_changed") && hasAny(["frontend_test_changed", "unit_test_changed", "test_case_added"])) {
    return withCategory("UI Component Pattern", "Add or Update UI Component Feature", 0.8, ["component and frontend/test signals repeated together"]);
  }
  if (has("cli_command_changed") && hasAny(["unit_test_changed", "integration_test_changed", "test_case_added"])) {
    return withCategory("CLI Feature", "Add or Update CLI Feature", 0.78, ["CLI command or option changes repeated with test signals"]);
  }
  if (has("cli_command_changed")) {
    return withCategory("CLI Feature", "Add or Update CLI Feature", 0.72, ["CLI command or option changes were visible in diffs"]);
  }
  if (has("ci_changed") && has("config_changed")) {
    return withCategory("Build or CI Configuration Pattern", "Update Build or CI Configuration", 0.78, ["CI and configuration signals repeated together"]);
  }
  if (hasAny(["ui_changed", "component_changed", "page_or_screen_changed"]) && has("backend_changed")) {
    return withCategory("Full-Stack Feature Pattern", "Update Full-Stack Feature Pattern", 0.68, ["frontend and backend signals repeated together"]);
  }
  if (has("backend_changed") && has("db_changed") && hasAny(["unit_test_changed", "integration_test_changed", "test_case_added"])) {
    return withCategory("Backend and Database Feature", "Update Backend and Database Feature", 0.68, ["backend, database, and test signals repeated together"]);
  }
  if (has("backend_changed") && hasAny(["unit_test_changed", "integration_test_changed", "test_case_added"])) {
    return withCategory("Backend Pattern", "Update Backend and Test Pattern", 0.62, ["backend and test signals repeated together"]);
  }
  if (has("db_changed")) {
    return withCategory("Database Change Pattern", "Update Database Change Pattern", 0.58, ["database signals were dominant"]);
  }
  if (hasAny(["ui_changed", "component_changed", "page_or_screen_changed"])) {
    return withCategory("Frontend Change Pattern", "Update Frontend Change Pattern", 0.58, ["frontend/UI signals were dominant"]);
  }
  if (hasAny(["config_changed", "package_or_dependency_changed", "docker_changed", "terraform_or_infra_changed", "deployment_changed"])) {
    return withCategory("Configuration or Infrastructure Pattern", "Update Configuration or Infrastructure Pattern", 0.56, ["configuration or infrastructure signals were dominant"]);
  }
  if (has("docs_changed")) {
    return withCategory("Documentation Pattern", "Update Documentation Pattern", 0.54, ["documentation signals were dominant"]);
  }
  if (termEvidence.repeated.length > 0 || frameworks.length > 0) {
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

function confidenceFactors(cluster: WorkingCluster, totalCommits: number, namingReasons: string[], learnedSurface?: LearnedSurfaceMatch): string[] {
  const commits = cluster.commits;
  const dominant = dominantSignals(cluster, 6);
  return [
    `${commits.length} of ${totalCommits} scanned commits matched this repeated change shape.`,
    learnedSurface
      ? `Learned implementation surface: ${learnedSurface.displayName} under ${learnedSurface.commonDirectory} (${Math.round(learnedSurface.confidence * 100)}% match confidence).`
      : "No learned implementation surface was strong enough for this cluster.",
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
  const changedFiles = nonNoisyFiles(commit.changedFiles);
  const evidenceFiles = changedFiles.length > 0 ? changedFiles : commit.changedFiles;
  return {
    hash: commit.hash,
    shortHash: commit.shortHash,
    message: commit.message,
    changedFiles: evidenceFiles,
    diffSignals: commit.diffSummary.signals
      .filter((signal) => !isNoisyEvidenceFile(signal.filePath))
      .slice(0, 6)
      .map((signal) => `${signal.type}:${signal.value} (${signal.filePath})`),
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

function computeDomainTermEvidence(commits: CommitMetadata[], scan: ScanResult): DomainTermEvidence {
  const termCommits = new Map<string, Set<string>>();
  const rejectedNoisy = new Set<string>();
  const dynamicNoisyTerms = projectNoiseTerms(scan);
  for (const term of topLevelProjectTerms(commits)) {
    dynamicNoisyTerms.add(term);
  }

  for (const commit of commits) {
    const terms = [
      ...commit.messageTerms,
      ...nonNoisyFiles(commit.changedFiles).flatMap(fileTerms),
      ...nonNoisyFiles(commit.changedFiles).flatMap((file) => directoryTerms(path.dirname(file))),
      ...commit.diffSummary.signals.filter((signal) => !isNoisyEvidenceFile(signal.filePath)).flatMap(signalValueTerms)
    ];

    for (const term of terms) {
      const normalized = normalizeTerm(term);
      if (!normalized) {
        continue;
      }

      if (isNoisyTerm(normalized) || dynamicNoisyTerms.has(normalized)) {
        rejectedNoisy.add(normalized);
        continue;
      }

      if (!termCommits.has(normalized)) {
        termCommits.set(normalized, new Set());
      }
      termCommits.get(normalized)?.add(commit.hash);
    }
  }

  const ranked = [...termCommits.entries()]
    .map(([term, commitSet]) => ({ term, commitCount: commitSet.size }))
    .filter((entry) => entry.commitCount >= Math.min(2, commits.length))
    .sort((a, b) => b.commitCount - a.commitCount || a.term.localeCompare(b.term));

  const selected = dedupeSingularPlural(ranked.map((entry) => entry.term)).slice(0, 3);
  const maxCoverage = ranked[0]?.commitCount ?? 0;
  const strength = commits.length === 0 ? 0 : Math.min(1, maxCoverage / commits.length + selected.length * 0.08);

  return {
    selected,
    rejectedNoisy: [...rejectedNoisy].sort().slice(0, 12),
    repeated: dedupeSingularPlural(ranked.slice(0, 10).map((entry) => entry.term)),
    strength
  };
}

function refineDomainTermEvidence(termEvidence: DomainTermEvidence, commits: CommitMetadata[], signals: GenericSignal[]): DomainTermEvidence {
  const rejected = new Set(termEvidence.rejectedNoisy);
  const remove = new Set<string>();

  if (hasUiEvidence(commits, signals) && !apiClientFilesDominate(commits)) {
    remove.add("api");
  }

  const filterTerms = (terms: string[]) => terms.filter((term) => {
    if (remove.has(term)) {
      rejected.add(term);
      return false;
    }
    return true;
  });

  return {
    ...termEvidence,
    selected: filterTerms(termEvidence.selected),
    repeated: filterTerms(termEvidence.repeated),
    rejectedNoisy: [...rejected].sort().slice(0, 12)
  };
}

function generateTaskSkillName(
  area: PrimaryArea,
  signals: GenericSignal[],
  commonFiles: string[],
  terms: string[],
  genericCategory: string,
  learnedSurface?: LearnedSurfaceMatch
): string {
  const surfaceName = learnedSurface ? learnedSurfaceTaskName(learnedSurface, terms, commonFiles, signals) : "";
  if (surfaceName && shouldPreferSurfaceTaskName(area, genericCategory, signals)) {
    return surfaceName;
  }

  const feature = dominantFeatureNoun(terms, commonFiles, signals, area, genericCategory);
  const hasApi = hasApiSignal(signals, genericCategory);

  if (area === "frontend") {
    if (feature === "Reporting") {
      return prefersWorkbench(commonFiles, terms) ? "Add or Update Reporting Workbench UI" : "Update Reporting Dashboard UI";
    }
    return feature ? `Update ${feature} UI` : "Update UI Component";
  }

  if (area === "cli") {
    return feature ? `Add or Update ${feature} CLI Workflow` : "Add CLI Command";
  }

  if (area === "backend") {
    if (hasApi) {
      return feature ? `Update ${feature} Backend API Behavior` : "Update Backend API Behavior";
    }
    if (signals.includes("queue_or_event_handler_changed") || signals.includes("background_job_changed")) {
      return feature ? `Add or Update ${feature} Async Job or Event Handler` : "Add or Update Async Job or Event Handler";
    }
    return feature ? `Update ${feature} Backend Behavior` : "Update Backend Behavior";
  }

  if (area === "db") {
    return feature ? `Add or Update ${feature} Database-Backed Feature` : "Add Database-Backed Feature";
  }

  if (area === "infra") {
    if (signals.includes("ci_changed")) {
      return feature ? `Update ${feature} Build or CI Configuration` : "Update Build or CI Configuration";
    }
    return feature ? `Update ${feature} Runtime Configuration` : "Update Runtime Configuration";
  }

  if (area === "docs") {
    return feature && feature !== "Project" ? `Update ${feature} Documentation` : "Update Project Documentation";
  }

  if (area === "tests") {
    return feature ? `Update ${feature} Tests` : "Update Tests";
  }

  if (feature) {
    return `Update ${feature} Change Workflow`;
  }

  return "Update Engineering Workflow";
}

function shouldPreferSurfaceTaskName(area: PrimaryArea, genericCategory: string, signals: GenericSignal[]): boolean {
  if (area === "unknown" || area === "mixed" || area === "tests") {
    return true;
  }
  if (/Repeated Engineering|Full-Stack|Change Pattern|Frontend Change|Backend Pattern|Configuration or Infrastructure/.test(genericCategory)) {
    return true;
  }
  const nonTestSignals = signals.filter((signal) => !isTestSignal(signal));
  return nonTestSignals.length === 0;
}

function learnedSurfaceTaskName(surface: LearnedSurfaceMatch, terms: string[], commonFiles: string[], signals: GenericSignal[]): string {
  const surfaceTerms = new Set([
    ...surface.repeatedTerms,
    ...terms,
    ...pathTerms(surface.commonDirectory),
    ...commonFiles.flatMap((file) => [...pathTerms(file), ...pathTerms(path.dirname(file))])
  ].map((term) => normalizeTerm(term)).filter((term): term is string => Boolean(term)).filter((term) => !isFeatureNoiseTerm(term)));
  const directoryTermsSet = new Set(pathTerms(surface.commonDirectory).map((term) => normalizeTerm(term)).filter((term): term is string => Boolean(term)));
  const has = (...values: string[]) => values.some((value) => surfaceTerms.has(value));
  const strongCommandTerm = surface.repeatedTerms.some((term) => /^(cli|command|commands|flag|flags|option|options)$/.test(term)) || signals.includes("cli_command_changed");
  const domainTerms = dedupeSingularPlural([...surfaceTerms].filter((term) => !directoryTermsSet.has(term) && !["command", "commands", "component", "components", "server", "client"].includes(term))).slice(0, 2);
  const domain = domainTerms.map(domainTermToTitle).join(" ");

  if (has("ui", "frontend", "client", "web", "component", "components", "page", "pages", "screen", "screens", "view", "views")) {
    return domain ? `Update ${domain} UI` : "Update UI Surface";
  }

  if (has("command", "commands", "cmd", "cli")) {
    if (strongCommandTerm) {
      return domain ? `Add or Update ${domain} CLI Workflow` : "Add CLI Command";
    }
    return domain ? `Update ${domain} Commands` : "Update Commands";
  }

  if (has("migration", "migrations", "schema", "schemas", "database", "db")) {
    return domain ? `Update ${domain} Database Schema` : "Update Database Schema";
  }

  if (has("api", "route", "routes", "server", "handler", "handlers")) {
    return domain ? `Update ${domain} API Behavior` : "Update API Behavior";
  }

  if (has("docs", "documentation", "readme", "changelog")) {
    return domain ? `Update ${domain} Documentation` : "Update Project Documentation";
  }

  const base = surfaceBaseName(surface);
  return domain && !base.toLowerCase().includes(domain.toLowerCase()) ? `Update ${domain} ${base}` : `Update ${base}`;
}

function surfaceBaseName(surface: LearnedSurfaceMatch): string {
  const terms = pathTerms(surface.commonDirectory)
    .map((term) => normalizeTerm(term))
    .filter((term): term is string => Boolean(term))
    .filter((term) => !["src", "lib", "app", "apps", "source"].includes(term));
  const selected = dedupeSingularPlural(terms).slice(-2);
  if (selected.length === 0) {
    return "Repository Workflow";
  }
  return selected.map(domainTermToTitle).join(" ");
}

function generateTaskDescription(
  taskName: string,
  primaryAreaValue: PrimaryArea,
  commits: CommitMetadata[],
  signals: GenericSignal[],
  commonFiles: string[],
  terms: string[],
  genericCategory: string,
  learnedSurface?: LearnedSurfaceMatch
): string {
  if (learnedSurface && shouldPreferSurfaceTaskDescription(primaryAreaValue, genericCategory, signals)) {
    const examples = learnedSurface.representativeFiles.slice(0, 2).map((file) => path.basename(file).replace(/\.[^.]+$/i, "")).join(", ");
    return `Use this for changes to the learned ${learnedSurface.displayName} under ${learnedSurface.commonDirectory}${examples ? `, including examples like ${examples}` : ""}.`;
  }

  const area = primaryAreaValue === "mixed" || primaryAreaValue === "unknown"
    ? effectiveTaskArea(commits, signals, commonFiles)
    : primaryAreaValue;
  const feature = lowerFeaturePhrase(dominantFeatureNoun(terms, commonFiles, signals, area, genericCategory));
  const hasApi = hasApiSignal(signals, genericCategory);

  if (taskName === "Update Reporting Dashboard UI" || taskName === "Add or Update Reporting Workbench UI") {
    return "Use this for reporting dashboard/workbench UI changes involving UI components, UI API wiring, and UI tests.";
  }

  if (area === "frontend") {
    const subject = feature ? `${feature} UI` : "UI component or screen";
    return `Use this for ${subject} changes involving components, screens, API client wiring, or related UI tests.`;
  }

  if (area === "cli") {
    const subject = feature ? `${feature} CLI workflow` : "CLI command";
    return `Use this for ${subject} changes involving command registration, option parsing, handlers, and tests.`;
  }

  if (area === "backend") {
    const subject = feature ? `${feature} backend` : "backend";
    const apiPhrase = hasApi ? " API route, controller, service, handler, and test changes" : " service, handler, middleware, and test changes";
    return `Use this for ${subject}${apiPhrase}.`;
  }

  if (area === "db") {
    const subject = feature ? `${feature} database-backed` : "database-backed";
    return `Use this for ${subject} changes involving migrations, schema/model updates, queries, repositories, and tests.`;
  }

  if (area === "infra") {
    const subject = feature ? `${feature} runtime or build configuration` : "runtime, build, CI, or infrastructure configuration";
    return `Use this for ${subject} changes with matching validation commands from the owning project.`;
  }

  if (area === "docs" || primaryAreaValue === "docs") {
    const subject = feature ? `${feature} documentation` : "project documentation";
    return `Use this for ${subject} updates involving README, docs, changelog, or design-note files.`;
  }

  if (area === "tests") {
    const subject = feature ? `${feature} tests` : "test coverage";
    return `Use this for ${subject} changes involving focused test cases, fixtures, and nearby source examples.`;
  }

  return "Use this for repeated repository changes where the examples and evidence show a concrete source/test workflow.";
}

function shouldPreferSurfaceTaskDescription(area: PrimaryArea, genericCategory: string, signals: GenericSignal[]): boolean {
  return shouldPreferSurfaceTaskName(area, genericCategory, signals) || /Surface$/.test(genericCategory);
}

function effectiveTaskArea(commits: CommitMetadata[], signals: GenericSignal[], commonFiles: string[]): PrimaryArea {
  if (hasUiEvidence(commits, signals, commonFiles)) return "frontend";
  if (signals.includes("cli_command_changed")) return "cli";
  if (signals.includes("api_route_changed") || signals.includes("controller_changed") || signals.includes("service_layer_changed")) return "backend";
  if (signals.includes("migration_changed") || signals.includes("schema_changed") || signals.includes("model_or_entity_changed") || signals.includes("query_changed")) return "db";
  if (signals.includes("ci_changed") || signals.includes("config_changed") || signals.includes("docker_changed") || signals.includes("terraform_or_infra_changed")) return "infra";
  if (signals.includes("docs_changed") || signals.includes("readme_changed") || signals.includes("adr_or_design_doc_changed")) return "docs";
  if (signals.some(isTestSignal)) return "tests";
  return primaryArea(commits).area;
}

function dominantFeatureNoun(terms: string[], commonFiles: string[], signals: GenericSignal[], area: PrimaryArea, genericCategory: string): string {
  const lowered = new Set(terms.map((term) => term.toLowerCase()));
  const fileText = commonFiles.join(" ").toLowerCase();
  const taskFileText = commonFiles.filter((file) => isTaskSourceFile(area, genericCategory, file)).join(" ").toLowerCase();
  const hasTerm = (...values: string[]) => values.some((value) => lowered.has(value) || taskFileText.includes(value) || (area !== "cli" && fileText.includes(value)));

  if (area === "cli") {
    if (taskFileText.includes("repair")) return "Repair";
    if (taskFileText.includes("audit")) return "Audit";
    if (taskFileText.includes("report")) return "Reporting";
    return "";
  }

  if (hasTerm("report", "reporting", "reports")) {
    if (area === "frontend") return "Reporting";
    if (hasTerm("audit")) return "Audit Reporting";
    return "Reporting";
  }
  if (hasTerm("evidence") && hasTerm("heuristic", "heuristics")) return "Evidence Heuristics";
  if (hasTerm("heuristic", "heuristics")) return hasTerm("runtime") ? "Runtime Heuristics" : "Heuristics";
  if (hasTerm("repair")) return "Repair";
  if (hasTerm("crawl") && hasTerm("graph")) return "Crawl Graph";
  if (hasTerm("grid", "table", "columns")) return "Grid";
  if (area === "docs" && (hasTerm("readme") || signals.includes("readme_changed"))) return "Project";

  const selected = terms
    .filter((term) => !isFeatureNoiseTerm(term))
    .slice(0, 2);

  return selected.map(domainTermToTitle).join(" ");
}

function lowerFeaturePhrase(feature: string): string {
  return feature
    .split(" ")
    .filter(Boolean)
    .map((word) => ["UI", "API", "CLI", "CI"].includes(word) ? word : word.toLowerCase())
    .join(" ");
}

function isFeatureNoiseTerm(term: string): boolean {
  const normalized = normalizeTerm(term);
  if (!normalized) return true;
  return NOISY_NAMING_TERMS.has(normalized) || normalized === "api" || normalized === "error" || normalized === "errors";
}

function hasObviousJunkName(name: string): boolean {
  const normalized = name.toLowerCase();
  return /\b(aicompatible|compatible|all|run|runs|running|action|actions)\b/.test(normalized) || /\bpattern\b/i.test(name);
}

function hasUiEvidence(commits: CommitMetadata[], signals: GenericSignal[], files: string[] = commits.flatMap((commit) => commit.changedFiles)): boolean {
  if (signals.some((signal) => ["ui_changed", "component_changed", "page_or_screen_changed", "style_changed", "frontend_test_changed"].includes(signal))) {
    return true;
  }
  return files.some((file) => /(^|\/)(ui|frontend|client|web)\/src\/(components?|pages?|screens?|views?|routes?|api)|(^|\/)src\/(components?|pages?|screens?|views?)(\/|$)/i.test(file));
}

function apiClientFilesDominate(commits: CommitMetadata[]): boolean {
  const usefulFiles = nonNoisyFiles(commits.flatMap((commit) => commit.changedFiles));
  const apiClientFiles = usefulFiles.filter((file) => /(^|\/)(ui|frontend|client|web)\/src\/api(?:\.|\/)|(^|\/)api(?:Client|\.client)?\.(tsx?|jsx?)$/i.test(file));
  const uiSourceFiles = usefulFiles.filter((file) => /(^|\/)(ui|frontend|client|web)\/src\/|(^|\/)src\/(components?|pages?|screens?|views?)(\/|$)/i.test(file));
  return apiClientFiles.length > 0 && apiClientFiles.length > Math.max(1, uiSourceFiles.length - apiClientFiles.length);
}

function prefersWorkbench(commonFiles: string[], terms: string[]): boolean {
  return [...commonFiles, ...terms].some((value) => /workbench/i.test(value));
}

function adjustedNamingConfidence(
  rawConfidence: number,
  commits: CommitMetadata[],
  signals: GenericSignal[],
  evidenceFiles: string[],
  taskArea: PrimaryArea,
  genericCategory: string,
  validationCommands: string[],
  artifactShare: number,
  taskName: string,
  domainTerms: string[],
  learnedSurface?: LearnedSurfaceMatch
): { confidence: number; reasons: string[] } {
  let confidence = rawConfidence;
  const reasons: string[] = [];
  const strongAlignment = hasStrongSourceTestAlignment(taskArea, genericCategory, evidenceFiles, signals, validationCommands, learnedSurface);

  if (learnedSurface && learnedSurface.confidence >= 0.65) {
    const surfaceFloor = 0.56 + learnedSurface.confidence * 0.22 + Math.min(0.12, learnedSurface.repeatedTerms.length * 0.04);
    confidence = Math.min(0.96, Math.max(confidence + 0.08, surfaceFloor));
    reasons.push(`naming confidence increased because the cluster maps to learned surface ${learnedSurface.displayName}`);
  }

  if (commits.length <= 3 && !strongAlignment) {
    const capped = Math.min(confidence, 0.75);
    if (capped < confidence) {
      reasons.push("naming confidence capped at 75% because the cluster has three or fewer evidence commits without strong source/test alignment");
      confidence = capped;
    }
  }

  if (artifactShare > AGENT_READY_MAX_ARTIFACT_SHARE) {
    const capped = Math.min(confidence, 0.7);
    if (capped < confidence) {
      reasons.push("naming confidence capped at 70% because generated artifacts are a large share of the evidence");
      confidence = capped;
    }
  }

  if (domainTerms.length > 0 && !taskNameUsesDomainTerms(taskName, domainTerms)) {
    const capped = Math.min(confidence, 0.72);
    if (capped < confidence) {
      reasons.push("naming confidence capped at 72% because repeated domain terms did not support the final task name");
      confidence = capped;
    }
  }

  return {
    confidence: Number(confidence.toFixed(2)),
    reasons
  };
}

function taskNameUsesDomainTerms(taskName: string, domainTerms: string[]): boolean {
  const normalizedName = taskName.toLowerCase();
  return domainTerms.some((term) => normalizedName.includes(term.toLowerCase()) || (term === "report" && /reporting/.test(normalizedName)));
}

function finalNamingConfidence(confidence: number, promotion: PromotionDecision): number {
  if (promotion.promotionLevel !== "pattern_candidate") {
    return confidence;
  }

  const demotedForNoise = promotion.reasons.some((reason) =>
    /(generated artifact|workflow quality|primary area|learned surface|source file matching|test or validation|noisy|over-broad)/i.test(reason)
  );
  return Number((demotedForNoise ? Math.min(confidence, 0.7) : confidence).toFixed(2));
}

function hasStrongSourceTestAlignment(
  taskArea: PrimaryArea,
  genericCategory: string,
  evidenceFiles: string[],
  signals: GenericSignal[],
  validationCommands: string[],
  learnedSurface?: LearnedSurfaceMatch
): boolean {
  const support = taskEvidenceSupport(taskArea, genericCategory, evidenceFiles, signals, validationCommands, learnedSurface);
  const sourceCount = evidenceFiles.filter((file) => isSurfaceSourceFile(file, learnedSurface)).length;
  return support.hasTaskSourceEvidence && support.hasTestOrValidationSignal && sourceCount >= 2;
}

function taskEvidenceSupport(
  taskArea: PrimaryArea,
  genericCategory: string,
  evidenceFiles: string[],
  signals: GenericSignal[],
  validationCommands: string[],
  learnedSurface?: LearnedSurfaceMatch
): TaskEvidenceSupport {
  return {
    hasTaskSourceEvidence: evidenceFiles.some((file) => isSurfaceSourceFile(file, learnedSurface)),
    hasTestOrValidationSignal: evidenceFiles.some(isTestFile) || signals.some(isTestSignal) || validationCommands.length > 0 || (learnedSurface?.coChangingTestFiles.length ?? 0) > 0
  };
}

function isTaskSourceFile(taskArea: PrimaryArea, genericCategory: string, filePath: string): boolean {
  if (isNoisyEvidenceFile(filePath) || isTestFile(filePath)) {
    return false;
  }

  switch (taskArea) {
    case "frontend":
      return isUiSourceFile(filePath);
    case "cli":
      return isCliSourceFile(filePath);
    case "backend":
      return /Backend API/.test(genericCategory) ? isBackendApiSourceFile(filePath) : isBackendSourceFile(filePath);
    case "db":
      return isDatabaseSourceFile(filePath);
    case "infra":
      return isInfraSourceFile(filePath);
    case "docs":
      return isDocsSourceFile(filePath);
    case "tests":
      return isTestFile(filePath);
    default:
      return isSourceFile(filePath);
  }
}

function isSurfaceSourceFile(filePath: string, learnedSurface?: LearnedSurfaceMatch): boolean {
  if (isNoisyEvidenceFile(filePath) || isTestFile(filePath) || inferFileRole(filePath) !== "source") {
    return false;
  }

  if (!learnedSurface) {
    return isSourceFile(filePath);
  }

  return fileBelongsToLearnedSurfaceMatch(filePath, learnedSurface);
}

function fileBelongsToLearnedSurfaceMatch(filePath: string, surface: LearnedSurfaceMatch): boolean {
  const normalized = path.normalize(filePath);
  return normalized === surface.commonDirectory ||
    normalized.startsWith(`${surface.commonDirectory}/`) ||
    surface.representativeFiles.includes(normalized) ||
    surfaceCoChangeFiles(surface).includes(normalized);
}

function surfaceCoChangeFiles(surface: Pick<LearnedSurfaceMatch, "coChangeEvidence" | "representativeFiles">): string[] {
  const representative = new Set(surface.representativeFiles);
  return unique(surface.coChangeEvidence
    .filter((edge) => edge.files.some((file) => representative.has(file)))
    .flatMap((edge) => edge.files)
    .filter((file) => inferFileRole(file) === "source"));
}

function isUiSourceFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return !isTestFile(lower) && (
    /(^|\/)(ui|frontend|client|web)\/src\/(components?|pages?|screens?|views?|routes?|api)(\/|\.|$)/i.test(lower) ||
    /(^|\/)src\/(components?|pages?|screens?|views?)(\/|$)/i.test(lower)
  );
}

function isCliSourceFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return !isTestFile(lower) && (
    /(^|\/)(src\/)?cli(\/|\.|$)/i.test(lower) ||
    /(^|\/)(commands?|cmd)(\/|$)/i.test(lower)
  ) && /\.(tsx?|jsx?|py|go|rs|cs|java|kt)$/i.test(lower);
}

function isBackendApiSourceFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return !isTestFile(lower) && (
    /(^|\/)(routes?|controllers?|handlers?|api|server)(\/|$)/i.test(lower) ||
    /(^|\/)(server|app)\.(tsx?|jsx?|py|go|rs|cs|java|kt)$/i.test(lower)
  ) && /\.(tsx?|jsx?|py|go|rs|cs|java|kt)$/i.test(lower);
}

function isBackendSourceFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return !isTestFile(lower) && (
    isBackendApiSourceFile(lower) ||
    /(^|\/)(services?|repositories?|dao|middleware|workers?|jobs?|events?|consumers?|subscribers?)(\/|$)/i.test(lower)
  ) && /\.(tsx?|jsx?|py|go|rs|cs|java|kt)$/i.test(lower);
}

function isDatabaseSourceFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return !isTestFile(lower) && (
    /(^|\/)(migrations?|db|database|models?|entities?|repositories?)(\/|$)/i.test(lower) ||
    /\.(sql|prisma)$/i.test(lower)
  );
}

function isInfraSourceFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return /(^|\/)(package\.json|makefile|dockerfile|docker-compose\.ya?ml|\.github\/workflows\/|\.gitlab-ci\.ya?ml|jenkinsfile|pom\.xml|build\.gradle(?:\.kts)?|pyproject\.toml|go\.mod|cargo\.toml)$/i.test(lower) ||
    /\.(ya?ml|toml|ini|json|tf)$/i.test(lower);
}

function isDocsSourceFile(filePath: string): boolean {
  return /\.(md|mdx|rst|adoc)$/i.test(filePath);
}

function decidePromotion(
  commits: CommitMetadata[],
  dominantSignals: GenericSignal[],
  evidenceFiles: string[],
  patternConfidence: number,
  namingConfidence: number,
  genericCategory: string,
  terms: string[],
  validationCommands: string[],
  proposedTaskName: string,
  taskArea: PrimaryArea,
  learnedSurface?: LearnedSurfaceMatch
): PromotionDecision {
  const primary = primaryArea(commits);
  const workflowQuality = calculateWorkflowQuality(commits, dominantSignals, evidenceFiles, validationCommands, learnedSurface);
  const artifactShare = generatedArtifactEvidenceShare(commits);
  const representativeFileCount = representativeSourceTestFiles(evidenceFiles, learnedSurface).length;
  const taskSupport = taskEvidenceSupport(taskArea, genericCategory, evidenceFiles, dominantSignals, validationCommands, learnedSurface);
  const hasWorkflow = workflowQuality >= DRAFT_WORKFLOW_QUALITY
    && actionableWorkflowKind(genericCategory, taskArea, terms, learnedSurface) !== "unknown"
    && taskSupport.hasTaskSourceEvidence;
  const hasJunkName = hasObviousJunkName(proposedTaskName);
  const surfaceConfidence = learnedSurface?.confidence ?? 0;
  const surfaceShare = learnedSurface?.matchShare ?? 0;
  const agentReadyFailures = thresholdFailures({
    commitCount: commits.length,
    patternConfidence,
    namingConfidence,
    primaryShare: primary.share,
    surfaceConfidence,
    surfaceShare,
    artifactShare,
    workflowQuality,
    representativeFileCount,
    hasWorkflow,
    hasJunkName,
    hasTaskSourceEvidence: taskSupport.hasTaskSourceEvidence,
    hasTestOrValidationSignal: taskSupport.hasTestOrValidationSignal,
    thresholds: {
      patternConfidence: AGENT_READY_PATTERN_CONFIDENCE,
      namingConfidence: AGENT_READY_NAMING_CONFIDENCE,
      primaryShare: AGENT_READY_PRIMARY_AREA_SHARE,
      surfaceConfidence: 0.65,
      surfaceShare: 0.65,
      artifactShare: AGENT_READY_MAX_ARTIFACT_SHARE,
      workflowQuality: AGENT_READY_WORKFLOW_QUALITY,
      representativeFileCount: 1,
      commitCount: MIN_CLUSTER_COMMITS,
      allowJunkName: false,
      requireTaskEvidence: true,
      requireTestOrValidation: true
    }
  });

  if (learnedSurface && agentReadyFailures.length === 0) {
    const reviewNotes = ["Promoted as agent-ready because the cluster is coherent, high-confidence, and has enough workflow evidence."];
    return {
      outputType: "skill",
      promotionLevel: "agent_ready",
      primaryArea: taskArea === "unknown" || taskArea === "mixed" ? primary.area : taskArea,
      primaryAreaShare: primary.share,
      workflowQuality,
      generatedArtifactEvidenceShare: artifactShare,
      reasons: ["Promoted to agent-ready skill."],
      reviewNotes
    };
  }

  const draftFailures = thresholdFailures({
    commitCount: commits.length,
    patternConfidence,
    namingConfidence,
    primaryShare: primary.share,
    surfaceConfidence,
    surfaceShare,
    artifactShare,
    workflowQuality,
    representativeFileCount,
    hasWorkflow,
    hasJunkName,
    hasTaskSourceEvidence: taskSupport.hasTaskSourceEvidence,
    hasTestOrValidationSignal: taskSupport.hasTestOrValidationSignal,
    thresholds: {
      patternConfidence: DRAFT_PATTERN_CONFIDENCE,
      namingConfidence: DRAFT_NAMING_CONFIDENCE,
      primaryShare: DRAFT_PRIMARY_AREA_SHARE,
      surfaceConfidence: 0.45,
      surfaceShare: 0.45,
      artifactShare: DRAFT_MAX_ARTIFACT_SHARE,
      workflowQuality: DRAFT_WORKFLOW_QUALITY,
      representativeFileCount: DRAFT_MIN_REPRESENTATIVE_FILES,
      commitCount: DRAFT_MIN_EVIDENCE_COMMITS,
      allowJunkName: false,
      requireTaskEvidence: true,
      requireTestOrValidation: true
    }
  });

  if (learnedSurface && draftFailures.length === 0) {
    return {
      outputType: "skill",
      promotionLevel: "draft",
      primaryArea: taskArea === "unknown" || taskArea === "mixed" ? primary.area : taskArea,
      primaryAreaShare: primary.share,
      workflowQuality,
      generatedArtifactEvidenceShare: artifactShare,
      reasons: agentReadyFailures.length > 0 ? agentReadyFailures : ["Needs human review before becoming trusted guidance."],
      reviewNotes: ["Generated as a draft skill because the cluster is useful but not clean enough to trust automatically."]
    };
  }

  return {
    outputType: "pattern",
    promotionLevel: "pattern_candidate",
    primaryArea: primary.area,
    primaryAreaShare: primary.share,
    workflowQuality,
    generatedArtifactEvidenceShare: artifactShare,
    reasons: draftFailures,
    reviewNotes: ["Not promoted to a skill. Review this pattern manually before turning it into agent guidance."]
  };
}

function thresholdFailures(input: {
  commitCount: number;
  patternConfidence: number;
  namingConfidence: number;
  primaryShare: number;
  surfaceConfidence: number;
  surfaceShare: number;
  artifactShare: number;
  workflowQuality: number;
  representativeFileCount: number;
  hasWorkflow: boolean;
  hasJunkName: boolean;
  hasTaskSourceEvidence: boolean;
  hasTestOrValidationSignal: boolean;
  thresholds: {
    patternConfidence: number;
    namingConfidence: number;
    primaryShare: number;
    surfaceConfidence: number;
    surfaceShare: number;
    artifactShare: number;
    workflowQuality: number;
    representativeFileCount: number;
    commitCount: number;
    allowJunkName: boolean;
    requireTaskEvidence: boolean;
    requireTestOrValidation: boolean;
  };
}): string[] {
  const failures: string[] = [];
  if (input.commitCount < input.thresholds.commitCount) failures.push(`Only ${input.commitCount} evidence commits were found.`);
  if (input.patternConfidence < input.thresholds.patternConfidence) failures.push(`Pattern confidence ${Math.round(input.patternConfidence * 100)}% is below threshold.`);
  if (input.namingConfidence < input.thresholds.namingConfidence) failures.push(`Naming confidence ${Math.round(input.namingConfidence * 100)}% is below threshold.`);
  if (input.surfaceConfidence < input.thresholds.surfaceConfidence) failures.push(`Learned surface confidence ${Math.round(input.surfaceConfidence * 100)}% is below threshold.`);
  if (input.surfaceShare < input.thresholds.surfaceShare) failures.push(`Only ${Math.round(input.surfaceShare * 100)}% of evidence commits match one learned implementation surface.`);
  if (input.artifactShare > input.thresholds.artifactShare) failures.push(`Generated artifact evidence share ${Math.round(input.artifactShare * 100)}% is above threshold.`);
  if (input.workflowQuality < input.thresholds.workflowQuality || !input.hasWorkflow) failures.push(`Workflow quality ${Math.round(input.workflowQuality * 100)}% is below threshold.`);
  if (input.representativeFileCount < input.thresholds.representativeFileCount) failures.push(`Only ${input.representativeFileCount} representative source/test files were found.`);
  if (!input.thresholds.allowJunkName && input.hasJunkName) failures.push("The proposed name contains noisy or over-broad terms.");
  if (input.thresholds.requireTaskEvidence && !input.hasTaskSourceEvidence) failures.push("No source file matching the proposed task type was found.");
  if (input.thresholds.requireTestOrValidation && !input.hasTestOrValidationSignal) failures.push("No matching test or validation signal was found.");
  return failures;
}

function calculateWorkflowQuality(
  commits: CommitMetadata[],
  dominantSignals: GenericSignal[],
  commonFiles: string[],
  validationCommands: string[],
  learnedSurface?: LearnedSurfaceMatch
): number {
  let score = 0;
  if (commonFiles.some((file) => isSurfaceSourceFile(file, learnedSurface))) score += 0.25;
  if (commonFiles.some(isTestFile) || (learnedSurface?.coChangingTestFiles.length ?? 0) > 0) score += 0.25;
  if (validationCommands.length > 0) score += 0.2;
  if (learnedSurface ? learnedSurface.confidence >= 0.45 : hasDominantGenericCategory(commits, dominantSignals)) score += 0.15;
  if (learnedSurface ? learnedSurface.representativeFiles.length > 0 : commonFiles.length > 0) score += 0.15;
  return Number(score.toFixed(2));
}

function hasDominantGenericCategory(commits: CommitMetadata[], dominantSignals: GenericSignal[]): boolean {
  const primary = primaryArea(commits);
  return primary.share >= 0.7 || broadAreas(dominantSignals).length <= 2;
}

function generatedArtifactEvidenceShare(commits: CommitMetadata[]): number {
  const files = commits.flatMap((commit) => commit.changedFiles);
  if (files.length === 0) {
    return 0;
  }
  return files.filter(isNoisyEvidenceFile).length / files.length;
}

function representativeSourceTestFiles(files: string[], learnedSurface?: LearnedSurfaceMatch): string[] {
  return files.filter((file) => isSurfaceSourceFile(file, learnedSurface) || isTestFile(file));
}

function isSourceFile(filePath: string): boolean {
  return inferFileRole(filePath) === "source" && !isTestFile(filePath);
}

function isTestFile(filePath: string): boolean {
  return /(\.spec\.|\.(test|tests)\.|_(test|spec)\.)|(^|\/)(__tests__|tests?|specs?|e2e|playwright|cypress)(\/|$)/i.test(filePath);
}

function neutralPatternCandidateName(
  signals: GenericSignal[],
  primaryAreaValue: PrimaryArea,
  primaryAreaShare: number,
  terms: string[],
  genericCategory: string
): string {
  const areas = patternAreaLabels(signals, genericCategory);
  const isMixed = primaryAreaValue === "mixed" || primaryAreaValue === "unknown" || primaryAreaShare < 0.6 || areas.length > 2;
  const domain = patternDomainHint(terms);

  if (isMixed) {
    const areaLabel = areas.slice(0, 2).join("/") || "Change";
    return trimPatternName(`Mixed ${areaLabel}${domain ? ` ${domain}` : ""} Changes`);
  }

  if (primaryAreaValue === "docs") return "Documentation Updates";
  if (primaryAreaValue === "cli") return trimPatternName(`CLI${signals.some(isTestSignal) ? "/Test" : ""} Change Cluster`);
  if (primaryAreaValue === "backend") return hasApiSignal(signals, genericCategory) ? "Backend/API Change Cluster" : "Backend Change Cluster";
  if (primaryAreaValue === "db") return "Database Change Cluster";
  if (primaryAreaValue === "infra") return signals.includes("fixture_changed") ? "Config/Fixture Change Cluster" : "Config Change Cluster";
  if (primaryAreaValue === "frontend") return trimPatternName(`UI${signals.some(isTestSignal) ? "/Test" : ""}${domain ? ` ${domain}` : ""} Changes`);
  if (primaryAreaValue === "tests") return "Test Change Cluster";

  return "Mixed Change Cluster";
}

function patternAreaLabels(signals: GenericSignal[], genericCategory: string): string[] {
  const labels = new Set<string>();
  for (const signal of signals) {
    if (/^(ui|component|page_or_screen|route_view|style|frontend)/.test(signal)) labels.add("UI");
    if (/^(backend|api_route|controller|service_layer|repository_or_dao|middleware|auth|validation|serialization|background_job|queue_or_event_handler)/.test(signal)) {
      labels.add(hasApiSignal(signals, genericCategory) ? "Backend/API" : "Backend");
    }
    if (/^(db|migration|schema|model_or_entity|seed_data|query|index)/.test(signal)) labels.add("Database");
    if (/^(config|env|package_or_dependency|package_script|ci|docker|terraform_or_infra|deployment)/.test(signal)) labels.add("Config");
    if (isTestSignal(signal)) labels.add("Test");
    if (/^(docs|readme|adr_or_design_doc|changelog)/.test(signal)) labels.add("Docs");
    if (/^cli_command/.test(signal)) labels.add("CLI");
  }
  return [...labels].sort((a, b) => patternAreaPriority(a) - patternAreaPriority(b));
}

function patternAreaPriority(area: string): number {
  const index = ["UI", "Backend/API", "Backend", "CLI", "Test", "Database", "Config", "Docs"].indexOf(area);
  return index === -1 ? 99 : index;
}

function patternDomainHint(terms: string[]): string {
  const lower = new Set(terms.map((term) => term.toLowerCase()));
  if (lower.has("report") || lower.has("reporting")) return "Reporting";
  if (lower.has("audit")) return "Audit";
  return "";
}

function hasApiSignal(signals: GenericSignal[], genericCategory: string): boolean {
  return signals.includes("api_route_changed") || /API/.test(genericCategory);
}

function isTestSignal(signal: GenericSignal): boolean {
  return /(test|fixture)/.test(signal);
}

function trimPatternName(name: string): string {
  return name
    .replace(/\b(Add|Update|Feature|Skill)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 6)
    .join(" ");
}

function filteredEvidenceFiles(commits: CommitMetadata[]): string[] {
  return commits.flatMap((commit) => nonNoisyFiles(commit.changedFiles));
}

function nonNoisyFiles(files: string[]): string[] {
  return files.filter((file) => !isNoisyEvidenceFile(file));
}

function isNoisyEvidenceFile(filePath: string): boolean {
  const normalized = path.normalize(filePath).replace(/^\.\/+/, "");
  const role = inferFileRole(normalized);
  return role === "generated" || role === "fixture" || role === "build-output" || role === "lockfile" || NOISY_EVIDENCE_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function projectNoiseTerms(scan: ScanResult): Set<string> {
  const values = [
    scan.repoRoot,
    scan.repositoryInput,
    scan.workspacePath,
    scan.remoteUrl
  ].filter((value): value is string => Boolean(value));
  const terms = new Set<string>(["app", "apps", "src", "test", "tests", "repo", "root", "workspace", "workspaces"]);

  for (const value of values) {
    const cleaned = value.replace(/\.git$/i, "");
    const basename = path.basename(cleaned);
    for (const term of tokenizeTerm(basename)) {
      terms.add(term);
    }

    const repoSlug = /github\.com[:/][^/]+\/([^/\s]+?)(?:\.git)?$/i.exec(cleaned)?.[1];
    if (repoSlug) {
      for (const term of tokenizeTerm(repoSlug)) {
        terms.add(term);
      }
    }
  }

  return terms;
}

function topLevelProjectTerms(commits: CommitMetadata[]): string[] {
  const termCommitCounts = new Map<string, Set<string>>();

  for (const commit of commits) {
    const topLevelDirs = unique(commit.changedFiles
      .map((file) => path.normalize(file).split("/")[0])
      .filter((part): part is string => typeof part === "string" && part.length > 0 && !part.includes(".")));

    for (const topLevelDir of topLevelDirs) {
      for (const term of tokenizeTerm(topLevelDir)) {
        if (!termCommitCounts.has(term)) {
          termCommitCounts.set(term, new Set());
        }
        termCommitCounts.get(term)?.add(commit.hash);
      }
    }
  }

  const minCommits = Math.max(2, Math.ceil(commits.length * 0.6));
  return [...termCommitCounts.entries()]
    .filter(([, commitSet]) => commitSet.size >= minCommits)
    .map(([term]) => term);
}

function fileTerms(filePath: string): string[] {
  const base = path.basename(filePath)
    .replace(/\.(spec|test|expected|report)$/i, "")
    .replace(/\.[^.]+$/i, "");
  return tokenizeTerm(base);
}

function dedupeSingularPlural(terms: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();

  for (const term of terms) {
    const singular = singularize(term);
    if (seen.has(term) || seen.has(singular)) {
      continue;
    }
    output.push(term);
    seen.add(term);
    seen.add(singular);
  }

  return output;
}

function singularize(term: string): string {
  if (term.endsWith("ies") && term.length > 4) {
    return `${term.slice(0, -3)}y`;
  }
  if (term.endsWith("s") && !term.endsWith("ss") && term.length > 3) {
    return term.slice(0, -1);
  }
  return term;
}

function primaryArea(commits: CommitMetadata[]): { area: PrimaryArea; share: number } {
  const counts = new Map<PrimaryArea, number>();

  for (const commit of commits) {
    const area = commitPrimaryArea(commit);
    if (area === "unknown") {
      continue;
    }
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }

  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || areaSort(a[0]) - areaSort(b[0]))[0];
  if (!top || commits.length === 0) {
    return { area: "unknown", share: 0 };
  }

  const [area, count] = top;
  return {
    area,
    share: Number((count / commits.length).toFixed(2))
  };
}

function commitPrimaryArea(commit: CommitMetadata): PrimaryArea {
  const scores = new Map<PrimaryArea, number>();

  for (const signal of commit.genericSignals) {
    const area = areaForSignal(signal);
    if (area === "unknown") {
      continue;
    }
    scores.set(area, (scores.get(area) ?? 0) + signalAreaWeight(signal, area));
  }

  const likely = likelyAreaToPrimary(commit.likelyArea);
  if (likely !== "unknown" && likely !== "mixed") {
    scores.set(likely, (scores.get(likely) ?? 0) + 0.35);
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || areaSort(a[0]) - areaSort(b[0]));
  const top = ranked[0];
  if (!top) {
    return "unknown";
  }

  const tied = ranked.filter((entry) => entry[1] === top[1]);
  if (tied.length > 1 && top[1] < 2) {
    return "mixed";
  }

  return top[0];
}

function broadAreas(signals: GenericSignal[]): PrimaryArea[] {
  return unique(signals.map(areaForSignal).filter((area) => area !== "unknown" && area !== "mixed"));
}

function areaForSignal(signal: GenericSignal): PrimaryArea {
  if (signal === "cli_command_changed") return "cli";
  if (/^(ui|component|page_or_screen|route_view|style|frontend)/.test(signal)) return "frontend";
  if (/^(backend|api_route|controller|service_layer|repository_or_dao|middleware|auth|validation|serialization|background_job|queue_or_event_handler)/.test(signal)) return "backend";
  if (/^(db|migration|schema|model_or_entity|seed_data|query|index)/.test(signal)) return "db";
  if (/^(config|env|package_or_dependency|package_script|ci|docker|terraform_or_infra|deployment)/.test(signal)) return "infra";
  if (/(test|fixture)/.test(signal)) return "tests";
  if (/^(docs|readme|adr_or_design_doc|changelog)/.test(signal)) return "docs";
  return "unknown";
}

function signalAreaWeight(signal: GenericSignal, area: PrimaryArea): number {
  if (area === "tests" || area === "docs") return 1;
  if (signal === "cli_command_changed") return 2.5;
  if (signal === "package_or_dependency_changed" || signal === "package_script_changed") return 1.5;
  return 2;
}

function likelyAreaToPrimary(area: CommitMetadata["likelyArea"]): PrimaryArea {
  if (area === "config") return "infra";
  if (area === "frontend" || area === "backend" || area === "tests" || area === "docs" || area === "mixed" || area === "unknown") {
    return area;
  }
  return "unknown";
}

function sourceEvidenceRatio(commits: CommitMetadata[]): number {
  const allFiles = commits.flatMap((commit) => commit.changedFiles);
  if (allFiles.length === 0) {
    return 0;
  }

  const usefulFiles = allFiles.filter((file) => !isNoisyEvidenceFile(file) && isUsefulEvidenceFile(file));
  return usefulFiles.length / allFiles.length;
}

function isUsefulEvidenceFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (isNoisyEvidenceFile(lower)) {
    return false;
  }

  return (
    /\.(tsx?|jsx?|py|java|kt|cs|go|rs|sql|prisma|md|mdx|rst|html|css|scss|sass|less|ya?ml|toml|ini|json)$/i.test(lower) ||
    /(^|\/)(src|app|lib|server|client|ui|frontend|backend|tests?|e2e|docs?|migrations?|db|database|config|configs|infra|deploy|scripts)(\/|$)/i.test(lower) ||
    /(^|\/)(dockerfile|makefile|package\.json|pom\.xml|build\.gradle(?:\.kts)?|cargo\.toml|go\.mod|pyproject\.toml)$/i.test(lower)
  );
}

function actionableWorkflowKind(genericCategory: string, area: PrimaryArea, terms: string[], learnedSurface?: LearnedSurfaceMatch): string {
  if (learnedSurface && learnedSurface.representativeFiles.length > 0) {
    return "learned-surface";
  }

  if (area === "mixed" || area === "unknown") {
    return "unknown";
  }

  if (/Backend API|Backend Pattern/.test(genericCategory)) return "backend";
  if (/Database/.test(genericCategory)) return "db";
  if (/UI|Frontend/.test(genericCategory)) return "frontend";
  if (/CLI/.test(genericCategory)) return "cli";
  if (/Configuration|Infrastructure|Build|CI/.test(genericCategory)) return "infra";
  if (/Documentation/.test(genericCategory)) return "docs";
  if (terms.length > 0 && ["frontend", "backend", "db", "infra", "tests", "docs", "cli"].includes(area)) {
    return area;
  }
  return "unknown";
}

function areaSort(area: PrimaryArea): number {
  return ["cli", "backend", "db", "frontend", "infra", "tests", "docs", "mixed", "unknown"].indexOf(area);
}

function buildDomainPhrase(terms: string[]): string {
  return terms.map(domainTermToTitle).join(" ");
}

function domainTermToTitle(term: string): string {
  const display = term === "report" ? "Reporting" : term;
  return display
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function directoryTerms(directory: string): string[] {
  return directory.split("/").flatMap((part) => tokenizeTerm(part));
}

function pathTerms(value: string): string[] {
  return value.split("/").flatMap((part) => tokenizeTerm(part.replace(/\.[^.]+$/i, "")));
}

function signalValueTerms(signal: DiffSignal): string[] {
  let value = signal.value.replace(/^(GET|POST|PUT|PATCH|DELETE|HANDLER)\s+/i, "");
  if (signal.type === "schema_changed" || signal.type === "index_changed" || signal.type === "query_changed") {
    value = value.replace(
      /\b(create|alter|drop|table|index|select|insert|update|delete|from|where|constraint|foreign|primary|unique|key|references)\b/gi,
      " "
    );
  }
  return tokenizeTerm(value);
}

function tokenizeTerm(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3);
}

function normalizeTerm(term: string): string | undefined {
  const normalized = term.toLowerCase().replace(/[^a-z0-9-]+/g, "");
  if (normalized.length < 3 || /^\d+$/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function isNoisyTerm(term: string): boolean {
  return NOISY_NAMING_TERMS.has(term);
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
