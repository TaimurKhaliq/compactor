import { posix as path } from "node:path";
import { emptyRoleCounts, inferFileRole, learnRepositoryPatterns } from "./repoLearning.js";
import { extractPathSignals } from "./genericSignals.js";
import { discoverValidationCommandsForFiles } from "../git/packageScripts.js";
import type { CandidateSkill, CommitMetadata, DiffSignal, EvidenceCommit, FileDiffSummary, FileRoleCounts, GenericSignal, LearnedSurface, MiningResult, PatternFamily, RepoLearning, ScanResult, SurfaceTaskKind, WorkflowAction, WorkflowActionSummary, WorkflowProfile, WorkflowStepEvidence } from "../types.js";

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

interface SurfaceEvidenceSplit {
  surfaceEvidenceCommits: CommitMetadata[];
  supportingEvidenceCommits: CommitMetadata[];
  rejectedEvidenceCommits: CommitMetadata[];
  relevantCommits: CommitMetadata[];
  relevantFiles: string[];
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
  /(^|\/)docs\/progress(\/|$)/i,
  /(^|\/)docs\/testfiles\.html$/i,
  /(^|\/)docs\/test-progress\.svg$/i,
  /(^|\/)data\/test-files\.csv$/i,
  /(^|\/)logs?(\/|$)/i,
  /(^|\/)test-results\.md$/i,
  /(^|\/)plan\.md$/i,
  /(^|\/)(fixtures?|reports?|replay|baselines?|snapshots?|coverage|dist|build|generated)(\/|$)/i,
  /(^|\/)package-lock\.json$/i,
  /(^|\/)repo_learning_state\.json$/i,
  /\.expected\.json$/i,
  /\.report\.json$/i
];

const SURFACE_SOURCE_TERM_NOISE = new Set([
  "src",
  "source",
  "lib",
  "app",
  "apps",
  "core",
  "common",
  "shared",
  "index",
  "main",
  "mod",
  "file",
  "files",
  "test",
  "tests",
  "spec",
  "docs",
  "doc",
  "readme",
  "generated",
  "fixture",
  "fixtures",
  "replay",
  "baseline",
  "baselines",
  "snapshot",
  "snapshots",
  "progress",
  "data"
]);

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
  const surfaceCandidates = clusters
    .filter((cluster) => cluster.commits.length >= MIN_CLUSTER_COMMITS)
    .map((cluster, index) => buildCandidate(cluster, { ...scan, repoLearning }, index))
    .sort((a, b) => b.patternConfidence - a.patternConfidence || b.namingConfidence - a.namingConfidence || a.name.localeCompare(b.name));
  const familyCandidates = buildPatternFamilyCandidates(scan, surfaceCandidates.length);
  const mined = [...surfaceCandidates, ...familyCandidates]
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
    surfaceEvidenceCommits: candidate.surfaceEvidenceCommits?.map((commit) => ({ ...commit, changedFiles: [...commit.changedFiles], diffSignals: [...commit.diffSignals], pathSignals: [...commit.pathSignals] })),
    supportingEvidenceCommits: candidate.supportingEvidenceCommits?.map((commit) => ({ ...commit, changedFiles: [...commit.changedFiles], diffSignals: [...commit.diffSignals], pathSignals: [...commit.pathSignals] })),
    rejectedEvidenceCommits: candidate.rejectedEvidenceCommits?.map((commit) => ({ ...commit, changedFiles: [...commit.changedFiles], diffSignals: [...commit.diffSignals], pathSignals: [...commit.pathSignals] })),
    commonFiles: [...candidate.commonFiles],
    commonDirectories: [...candidate.commonDirectories],
    observedConventions: [...candidate.observedConventions],
    observedChanges: [...candidate.observedChanges],
    workflowProfile: candidate.workflowProfile ? cloneWorkflowProfile(candidate.workflowProfile) : undefined,
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
    reviewNotes: [...candidate.reviewNotes],
    generatedFrom: candidate.generatedFrom ? [...candidate.generatedFrom] : undefined,
    patternFamily: candidate.patternFamily
      ? {
          ...candidate.patternFamily,
          frameworks: [...candidate.patternFamily.frameworks],
          libraries: [...candidate.patternFamily.libraries],
          concepts: [...candidate.patternFamily.concepts],
          roles: [...candidate.patternFamily.roles],
          representativeFiles: [...candidate.patternFamily.representativeFiles],
          sourceFiles: [...candidate.patternFamily.sourceFiles],
          similarityScores: candidate.patternFamily.similarityScores.map((similarity) => ({
            ...similarity,
            files: [...similarity.files] as [string, string],
            sharedFeatures: [...similarity.sharedFeatures]
          })),
          reasons: [...candidate.patternFamily.reasons]
        }
      : undefined
  };
}

function cloneWorkflowProfile(profile: WorkflowProfile): WorkflowProfile {
  return {
    actions: profile.actions.map(cloneWorkflowActionSummary),
    sourceActions: profile.sourceActions.map(cloneWorkflowActionSummary),
    testActions: profile.testActions.map(cloneWorkflowActionSummary),
    supportingArtifactActions: profile.supportingArtifactActions.map(cloneWorkflowActionSummary),
    validationCommands: [...profile.validationCommands],
    primaryValidationCommands: [...profile.primaryValidationCommands],
    secondaryValidationCommands: [...profile.secondaryValidationCommands],
    steps: profile.steps.map((step) => ({ ...step, files: [...step.files] })),
    coreSteps: profile.coreSteps.map((step) => ({ ...step, files: [...step.files] })),
    supportingSteps: profile.supportingSteps.map((step) => ({ ...step, files: [...step.files] })),
    usesGenericFallback: profile.usesGenericFallback
  };
}

function cloneWorkflowActionSummary(summary: WorkflowActionSummary): WorkflowActionSummary {
  return {
    ...summary,
    files: [...summary.files],
    commits: [...summary.commits]
  };
}

function mergeCandidateEvidence(target: CandidateSkill, source: CandidateSkill): void {
  target.evidenceCommits = mergeEvidenceCommits(target.evidenceCommits, source.evidenceCommits);
  target.surfaceEvidenceCommits = mergeEvidenceCommits(target.surfaceEvidenceCommits ?? [], source.surfaceEvidenceCommits ?? []);
  target.supportingEvidenceCommits = mergeEvidenceCommits(target.supportingEvidenceCommits ?? [], source.supportingEvidenceCommits ?? []);
  target.rejectedEvidenceCommits = mergeEvidenceCommits(target.rejectedEvidenceCommits ?? [], source.rejectedEvidenceCommits ?? []);
  target.rawEvidenceCommitCount = (target.rawEvidenceCommitCount ?? target.evidenceCommits.length) + (source.rawEvidenceCommitCount ?? source.evidenceCommits.length);
  target.surfaceRelevantCommitCount = target.evidenceCommits.length;
  target.rejectedEvidenceCommitCount = (target.rejectedEvidenceCommitCount ?? 0) + (source.rejectedEvidenceCommitCount ?? 0);
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

function clusterFromCommits(commits: CommitMetadata[], repoLearning: RepoLearning): WorkingCluster {
  const cluster: WorkingCluster = {
    commits: [],
    signalCounts: new Map(),
    directoryCounts: new Map(),
    surfaceCounts: new Map()
  };

  for (const commit of commits) {
    addCommitToCluster(cluster, commit, surfaceIdsForCommit(repoLearning, commit));
  }

  return cluster;
}

function surfaceIdsForCommit(repoLearning: RepoLearning, commit: CommitMetadata): string[] {
  const files = commit.changedFiles.map((file) => path.normalize(file));
  return repoLearning.surfaces
    .filter((surface) => files.some((file) => fileDirectlyTouchesSurface(file, surface)))
    .map((surface) => surface.id);
}

function fileBelongsToSurface(filePath: string, surface: Pick<LearnedSurfaceMatch, "commonDirectory" | "representativeFiles" | "coChangingTestFiles" | "coChangingConfigOrDocsFiles" | "coChangeEvidence">): boolean {
  return fileDirectlyTouchesSurface(filePath, surface) || fileSupportsSurface(filePath, surface);
}

function fileDirectlyTouchesSurface(filePath: string, surface: Pick<LearnedSurfaceMatch, "commonDirectory" | "representativeFiles" | "coChangeEvidence">): boolean {
  const normalized = path.normalize(filePath);
  return normalized === surface.commonDirectory ||
    normalized.startsWith(`${surface.commonDirectory}/`) ||
    surface.representativeFiles.includes(normalized) ||
    surfaceCoChangeFiles(surface).includes(normalized);
}

function fileSupportsSurface(filePath: string, surface: Pick<LearnedSurfaceMatch, "coChangingTestFiles" | "coChangingConfigOrDocsFiles">): boolean {
  const normalized = path.normalize(filePath);
  if (isNoisyEvidenceFile(normalized)) {
    return false;
  }

  return surface.coChangingTestFiles.includes(normalized) || surface.coChangingConfigOrDocsFiles.includes(normalized);
}

function fileCanSupportSurfaceWorkflow(filePath: string, surface: LearnedSurfaceMatch): boolean {
  const normalized = path.normalize(filePath);
  if (isNoisyEvidenceFile(normalized) || fileDirectlyTouchesSurface(normalized, surface) || isTestFile(normalized)) {
    return false;
  }

  const role = inferFileRole(normalized);
  if (role !== "source") {
    return false;
  }

  if (surface.taskKind === "ui") {
    return isApiClientFile(normalized, surface);
  }

  if (surface.taskKind === "api") {
    return isApiClientFile(normalized, surface) || /(^|\/)(models?|entities?|schemas?)(\/|$)/i.test(normalized);
  }

  return false;
}


function matchLearnedSurface(repoLearning: RepoLearning, commits: CommitMetadata[], evidenceFiles: string[], signals: GenericSignal[] = []): LearnedSurfaceMatch | undefined {
  const candidates = repoLearning.surfaces
    .map((surface) => surfaceMatchScore(surface, commits, evidenceFiles, signals))
    .filter((match): match is LearnedSurfaceMatch => Boolean(match))
    .sort((a, b) => b.confidence - a.confidence || surfaceSelectionRank(a, signals) - surfaceSelectionRank(b, signals) || surfaceSpecificity(b) - surfaceSpecificity(a) || b.matchShare - a.matchShare || a.commonDirectory.localeCompare(b.commonDirectory));

  return candidates[0];
}

function surfaceMatchScore(surface: LearnedSurface, commits: CommitMetadata[], evidenceFiles: string[], signals: GenericSignal[]): LearnedSurfaceMatch | undefined {
  const matchingCommits = commits.filter((commit) => commit.changedFiles.some((file) => fileDirectlyTouchesSurface(file, surface)));
  const matchShare = commits.length === 0 ? 0 : matchingCommits.length / commits.length;
  const usefulFiles = unique(evidenceFiles.map((file) => path.normalize(file)));
  const surfaceFiles = new Set([
    ...surface.representativeFiles,
    ...surface.coChangingTestFiles,
    ...surface.coChangingConfigOrDocsFiles
  ]);
  const overlap = usefulFiles.filter((file) => surfaceFiles.has(file) || fileDirectlyTouchesSurface(file, surface)).length;
  const overlapShare = usefulFiles.length === 0 ? 0 : overlap / usefulFiles.length;
  const inferredKind = inferSurfaceTaskKind(surface, signals);
  const sourceEvidence = usefulFiles.filter((file) => isSurfaceImplementationEvidence(file, inferredKind) && fileDirectlyTouchesSurface(file, surface));

  if (matchShare < 0.4 || sourceEvidence.length === 0) {
    return undefined;
  }

  const confidence = Number(Math.min(0.98, surface.confidence * 0.42 + matchShare * 0.34 + overlapShare * 0.16 + (surface.coChangingTestFiles.length > 0 ? 0.05 : 0) + (surface.validationCommands.length > 0 ? 0.03 : 0) + surfaceSignalAlignmentBoost(inferredKind, signals)).toFixed(2));
  const roleCounts = roleCountsForFiles(usefulFiles);

  return {
    id: surface.id,
    displayName: surface.displayName,
    commonDirectory: surface.commonDirectory,
    taskKind: inferredKind,
    confidence,
    matchShare: Number(matchShare.toFixed(2)),
    representativeFiles: surface.representativeFiles,
    coChangingTestFiles: surface.coChangingTestFiles,
    coChangingConfigOrDocsFiles: surface.coChangingConfigOrDocsFiles,
    dominantExtensions: surface.dominantExtensions,
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

function surfaceSignalAlignmentBoost(kind: SurfaceTaskKind, signals: GenericSignal[]): number {
  if (kind === "commands") return signals.includes("cli_command_changed") ? 0.05 : 0.04;
  if (kind === "ui" && signals.some((signal) => ["ui_changed", "component_changed", "page_or_screen_changed", "frontend_test_changed"].includes(signal))) return 0.04;
  if (kind === "api" && signals.includes("api_route_changed")) return 0.03;
  if (kind === "database" && signals.some((signal) => ["db_changed", "migration_changed", "schema_changed", "model_or_entity_changed"].includes(signal))) return 0.03;
  return 0;
}

function isSurfaceImplementationEvidence(filePath: string, kind: SurfaceTaskKind): boolean {
  const role = inferFileRole(filePath);
  if (role === "source") {
    return true;
  }
  return kind === "docs" && role === "docs";
}

function surfaceSelectionRank(surface: LearnedSurfaceMatch, signals: GenericSignal[]): number {
  const kind = surface.taskKind ?? inferSurfaceTaskKind(surface, signals);
  if (kind === "commands") return 0;
  if (kind === "ui" && signals.some((signal) => ["ui_changed", "component_changed", "page_or_screen_changed", "frontend_test_changed"].includes(signal))) return 1;
  if (kind === "api" && signals.includes("api_route_changed")) return 2;
  if (kind === "database") return 3;
  if (kind === "ui") return 4;
  return 5;
}

function surfaceSpecificity(surface: LearnedSurfaceMatch): number {
  return surface.commonDirectory.split("/").filter(Boolean).length + (surface.representativeFiles.length > 1 ? 0.5 : 0);
}

function enrichLearnedSurface(surface: LearnedSurfaceMatch, commits: CommitMetadata[], signals: GenericSignal[], scan: ScanResult): LearnedSurfaceMatch {
  const dynamicNoise = new Set([...projectNoiseTerms(scan), ...topLevelProjectTerms(commits)]);
  const sourceTerms = surfaceSourceTerms(surface, commits, dynamicNoise);
  const taskKind = inferSurfaceTaskKind({ ...surface, sourceTerms }, signals);
  return {
    ...surface,
    taskKind,
    sourceTerms,
    reasons: [
      ...surface.reasons,
      `Surface task kind inferred as ${taskKind}.`,
      sourceTerms.length > 0
        ? `Surface source terms used for naming: ${sourceTerms.slice(0, 6).join(", ")}.`
        : "No strong source-only surface terms were found for naming."
    ]
  };
}

function isStrongLearnedSurface(surface: LearnedSurfaceMatch | undefined): surface is LearnedSurfaceMatch {
  return Boolean(surface && surface.matchShare >= 0.65 && surface.confidence >= 0.65);
}

function splitSurfaceEvidence(commits: CommitMetadata[], surface: LearnedSurfaceMatch): SurfaceEvidenceSplit {
  const surfaceEvidenceCommits: CommitMetadata[] = [];
  const supportingEvidenceCommits: CommitMetadata[] = [];
  const rejectedEvidenceCommits: CommitMetadata[] = [];
  const relevantFiles: string[] = [];

  for (const commit of commits) {
    const files = commit.changedFiles.map((file) => path.normalize(file));
    const directFiles = files.filter((file) => fileDirectlyTouchesSurface(file, surface) && !isNoisyEvidenceFile(file));
    const supportingFiles = files.filter((file) => fileSupportsSurface(file, surface));
    const secondarySourceFiles = files.filter((file) => fileCanSupportSurfaceWorkflow(file, surface) && !directFiles.includes(file));

    if (directFiles.length > 0) {
      surfaceEvidenceCommits.push(commit);
      relevantFiles.push(...directFiles, ...secondarySourceFiles, ...supportingFiles);
      continue;
    }

    if (supportingFiles.length > 0) {
      supportingEvidenceCommits.push(commit);
      relevantFiles.push(...supportingFiles);
      continue;
    }

    rejectedEvidenceCommits.push(commit);
  }

  return {
    surfaceEvidenceCommits,
    supportingEvidenceCommits,
    rejectedEvidenceCommits,
    relevantCommits: [...surfaceEvidenceCommits, ...supportingEvidenceCommits],
    relevantFiles: unique(relevantFiles)
  };
}

function inferSurfaceTaskKind(surface: Pick<LearnedSurfaceMatch, "commonDirectory" | "representativeFiles" | "coChangingTestFiles" | "validationCommands" | "dominantExtensions" | "roleCounts" | "sourceTerms">, signals: GenericSignal[] = []): SurfaceTaskKind {
  const sourcePaths = [surface.commonDirectory, ...surface.representativeFiles].map((value) => value.toLowerCase());
  const sourceText = sourcePaths.join(" ");
  const extensions = new Set(surface.dominantExtensions ?? []);
  const sourceTerms = new Set(surface.sourceTerms ?? []);
  const hasPath = (pattern: RegExp) => sourcePaths.some((value) => pattern.test(value));
  const hasTerm = (...terms: string[]) => terms.some((term) => sourceTerms.has(term));

  if (hasPath(/(^|\/)(cli|commands?|cmd)(\/|$)/) || hasPath(/(^|\/)src\/(cli|commands?)\//)) {
    return "commands";
  }

  if (hasPath(/(^|\/)(ui|web|frontend|client)(\/|$)/) || hasPath(/(^|\/)(ui|web|frontend|client)\/src\/(components?|pages?|screens?|views?|routes?)(\/|$)/) || hasPath(/(^|\/)src\/(components?|pages?|screens?|views?)(\/|$)/)) {
    return "ui";
  }

  if (hasPath(/(^|\/)(migrations?|schemas?|database|db|models?|entities?)(\/|$)/) || extensions.has(".sql") || hasTerm("migration", "migrations", "schema", "database")) {
    return "database";
  }

  if (hasPath(/(^|\/)(server|api|routes?|controllers?|handlers?)(\/|$)/) || signals.includes("api_route_changed")) {
    return "api";
  }

  if (hasPath(/(^|\/)(config|configs|infra|deploy|deployment)(\/|$)/) || signals.some((signal) => ["config_changed", "ci_changed", "docker_changed", "terraform_or_infra_changed", "deployment_changed"].includes(signal))) {
    return "config";
  }

  if (hasPath(/(^|\/)(docs?|documentation)(\/|$)/) || /\.(md|mdx|rst|adoc)$/i.test(sourceText)) {
    return "docs";
  }

  if ((surface.roleCounts.test > surface.roleCounts.source && surface.roleCounts.source === 0) || surface.representativeFiles.every(isTestFile)) {
    return "tests";
  }

  return "source-workflow";
}

function surfaceSourceTerms(surface: LearnedSurfaceMatch, commits: CommitMetadata[], dynamicNoise = new Set<string>()): string[] {
  const representativeFiles = new Set(surface.representativeFiles.map((file) => path.normalize(file)));
  const evidence = new Map<string, { files: Set<string>; commits: Set<string>; directory: boolean }>();
  const add = (rawTerm: string, context: { file?: string; commit?: string; directory?: boolean }) => {
    const term = normalizeTerm(rawTerm);
    if (!term || dynamicNoise.has(term) || isSurfaceSourceNoiseTerm(term)) return;
    const entry = evidence.get(term) ?? { files: new Set<string>(), commits: new Set<string>(), directory: false };
    if (context.file) entry.files.add(context.file);
    if (context.commit) entry.commits.add(context.commit);
    if (context.directory) entry.directory = true;
    evidence.set(term, entry);
  };

  for (const term of pathTerms(surface.commonDirectory)) {
    add(term, { directory: true });
  }

  for (const file of surface.representativeFiles) {
    for (const term of [...pathTerms(file), ...pathTerms(path.dirname(file))]) {
      add(term, { file });
    }
  }

  for (const commit of commits) {
    for (const file of commit.changedFiles) {
      const normalized = path.normalize(file);
      if (inferFileRole(normalized) !== "source" || !fileBelongsToSurface(normalized, surface)) {
        continue;
      }

      for (const term of [...pathTerms(normalized), ...pathTerms(path.dirname(normalized))]) {
        add(term, { commit: commit.hash, file: normalized });
      }
    }

    for (const signal of commit.diffSummary.signals) {
      if (representativeFiles.has(path.normalize(signal.filePath)) && inferFileRole(signal.filePath) === "source") {
        for (const term of signalValueTerms(signal)) {
          add(term, { commit: commit.hash, file: signal.filePath });
        }
      }
    }
  }

  const selected = [...evidence.entries()]
    .filter(([, entry]) => entry.directory || entry.files.size >= 2 || entry.commits.size >= 2)
    .sort((a, b) => surfaceTermStrength(b[1]) - surfaceTermStrength(a[1]) || a[0].localeCompare(b[0]))
    .map(([term]) => term);

  return dedupeSingularPlural(selected)
    .slice(0, 8);
}

function surfaceTermStrength(entry: { files: Set<string>; commits: Set<string>; directory: boolean }): number {
  return entry.files.size + entry.commits.size + (entry.directory ? 1 : 0);
}

function isSurfaceSourceNoiseTerm(term: string): boolean {
  return SURFACE_SOURCE_TERM_NOISE.has(term) || isNoisyTerm(term);
}

function surfaceDomainTerms(surface: LearnedSurfaceMatch): string[] {
  if (surface.taskKind === "commands") {
    return [];
  }

  return (surface.sourceTerms ?? [])
    .filter((term) => !surfaceTaskGenericTerms(surface.taskKind).has(term))
    .slice(0, 3);
}

function surfaceTaskGenericTerms(kind: SurfaceTaskKind | undefined): Set<string> {
  const terms = new Set(["source", "workflow"]);
  if (kind === "ui") ["ui", "web", "frontend", "client", "api", "component", "components", "page", "pages", "screen", "screens", "view", "views"].forEach((term) => terms.add(term));
  if (kind === "api") ["api", "route", "routes", "server", "handler", "handlers", "controller", "controllers"].forEach((term) => terms.add(term));
  if (kind === "database") ["db", "database", "schema", "schemas", "migration", "migrations", "model", "models"].forEach((term) => terms.add(term));
  if (kind === "config") ["config", "configs", "runtime", "build", "infra"].forEach((term) => terms.add(term));
  if (kind === "docs") ["docs", "documentation"].forEach((term) => terms.add(term));
  if (kind === "tests") ["test", "tests", "spec", "specs"].forEach((term) => terms.add(term));
  if (kind === "commands") ["command", "commands", "cmd", "cli"].forEach((term) => terms.add(term));
  return terms;
}

function primaryAreaForSurfaceTaskKind(kind: SurfaceTaskKind): PrimaryArea {
  switch (kind) {
    case "commands":
      return "cli";
    case "ui":
      return "frontend";
    case "api":
      return "backend";
    case "database":
      return "db";
    case "config":
      return "infra";
    case "docs":
      return "docs";
    case "tests":
      return "tests";
    default:
      return "unknown";
  }
}

function genericCategoryForSurfaceTaskKind(kind: SurfaceTaskKind): string {
  switch (kind) {
    case "commands":
      return "Learned Commands Surface";
    case "ui":
      return "Learned UI Surface";
    case "api":
      return "Learned API Surface";
    case "database":
      return "Learned Database Surface";
    case "config":
      return "Learned Configuration Surface";
    case "docs":
      return "Learned Documentation Surface";
    case "tests":
      return "Learned Test Surface";
    default:
      return "Learned Source Workflow Surface";
  }
}

function roleCountsForFiles(files: string[]): FileRoleCounts {
  const counts = emptyRoleCounts();
  for (const file of files) {
    counts[inferFileRole(file)] += 1;
  }
  return counts;
}

function surfaceCommonFiles(files: string[], surface: LearnedSurfaceMatch): string[] {
  const selected = unique(files)
    .filter((file) => !isNoisyEvidenceFile(file))
    .sort((a, b) => surfaceFileRank(a, surface) - surfaceFileRank(b, surface) || a.localeCompare(b));
  return selected.slice(0, 8);
}

function surfaceCommonDirectories(files: string[], surface: LearnedSurfaceMatch): string[] {
  const directories = unique([
    surface.commonDirectory,
    ...surfaceCommonFiles(files, surface).map(directoryForFile)
  ]).filter((directory) => directory !== "repo root" || surface.commonDirectory === "repo root");

  return directories
    .filter((directory) => directory === surface.commonDirectory || !isNoisyEvidenceFile(`${directory}/placeholder`))
    .slice(0, 6);
}

function surfaceFileRank(file: string, surface: LearnedSurfaceMatch): number {
  if (isSurfaceImplementationEvidence(file, surface.taskKind ?? "source-workflow") && fileDirectlyTouchesSurface(file, surface)) return 0;
  if (fileSupportsSurface(file, surface) && isTestFile(file)) return 1;
  if (fileSupportsSurface(file, surface)) return 2;
  return 9;
}

function directoryForFile(file: string): string {
  const directory = path.dirname(file);
  return directory === "." ? "repo root" : directory;
}

function surfaceCoChangeEvidence(surface: LearnedSurfaceMatch): LearnedSurfaceMatch["coChangeEvidence"] {
  return surface.coChangeEvidence
    .filter((edge) => edge.files.every((file) => !isNoisyEvidenceFile(file)))
    .filter((edge) => edge.files.some((file) => fileDirectlyTouchesSurface(file, surface)))
    .filter((edge) => edge.files.every((file) => inferFileRole(file) === "source" || inferFileRole(file) === "test"))
    .slice(0, 8);
}

function buildPatternFamilyCandidates(scan: ScanResult, indexOffset: number): CandidateSkill[] {
  const families = (scan.patternFamilies ?? [])
    .filter((family) => isStrongPatternFamily(family))
    .slice(0, 20);

  return families.map((family, index) => buildPatternFamilyCandidate(family, scan, indexOffset + index));
}

function isStrongPatternFamily(family: PatternFamily): boolean {
  return family.fileCount >= 3 && family.confidence >= 0.68 && family.sourceFiles.some((file) => inferFileRole(file) === "source");
}

function buildPatternFamilyCandidate(family: PatternFamily, scan: ScanResult, index: number): CandidateSkill {
  const commits = commitsForPatternFamily(scan.commits, family);
  const evidenceCommits = commits.length > 0 ? commits : [];
  const signals = genericSignalsForPatternFamily(family);
  const primaryArea = primaryAreaForPatternFamily(family);
  const validationCommands = unique([
    ...discoverValidationCommandsForFiles(scan.repoRoot, family.sourceFiles),
    ...scan.validationCommands
  ]).slice(0, 5);
  const workflowQuality = workflowQualityForPatternFamily(family, validationCommands);
  const patternConfidence = Number(Math.min(0.98, family.confidence + (family.fileCount >= 4 ? 0.03 : 0)).toFixed(2));
  const namingConfidence = Number(Math.min(0.96, family.confidence + 0.04).toFixed(2));
  const promotionLevel = family.confidence >= 0.9 && family.fileCount >= 3 && workflowQuality >= 0.75
    ? "agent_ready"
    : "draft";
  const name = skillNameForPatternFamily(family);
  const id = uniqueSkillId(name, signals, index);
  const commonDirectories = topValues(family.sourceFiles.map(directoryForFile), 6);
  const familyEvidence = evidenceCommits.map((commit) => toEvidenceCommit(commit));

  return {
    id,
    name,
    taskDescription: taskDescriptionForPatternFamily(family, name),
    outputType: "skill",
    promotion_level: promotionLevel,
    primaryArea,
    primaryAreaShare: 1,
    workflowQuality,
    generatedArtifactEvidenceShare: 0,
    promotionReasons: [
      `Promoted from implementation fingerprint family ${family.name}.`,
      `${family.fileCount} files share implementation-shape features with ${Math.round(family.confidence * 100)}% confidence.`,
      promotionLevel === "draft"
        ? "Generated as a draft because fingerprint-derived guidance should be reviewed before becoming trusted."
        : "Generated as agent-ready because the family has high similarity confidence and enough workflow evidence."
    ],
    reviewNotes: [
      "Review representative files to confirm the implementation shape is genuinely reusable.",
      "Fingerprint families find similar files even when they never changed together."
    ],
    patternConfidence,
    namingConfidence,
    confidence: patternConfidence,
    evidenceCommits: familyEvidence,
    rawEvidenceCommitCount: evidenceCommits.length,
    surfaceRelevantCommitCount: evidenceCommits.length,
    rejectedEvidenceCommitCount: 0,
    commonFiles: family.representativeFiles.slice(0, 8),
    commonDirectories,
    observedConventions: observedConventionsForPatternFamily(family),
    observedChanges: observedChangesForPatternFamily(family),
    workflowProfile: undefined,
    suggestedValidationCommands: validationCommands,
    genericSignals: signals,
    repeatedTerms: unique([...family.concepts, ...family.roles, ...family.frameworks]).slice(0, 12),
    domainTerms: family.concepts.slice(0, 6),
    rejectedNoisyTerms: [],
    genericCategory: genericCategoryForPatternFamily(family),
    genericFallbackName: name,
    namingReasons: [
      `pattern family selected for name: ${family.name}`,
      family.frameworks.length > 0 ? `frameworks detected in fingerprints: ${family.frameworks.join(", ")}` : "no framework was required for naming",
      family.libraries.length > 0 ? `libraries detected in fingerprints: ${family.libraries.join(", ")}` : "no library was required for naming",
      family.concepts.length > 0 ? `shared implementation concepts: ${family.concepts.slice(0, 6).join(", ")}` : "no strong shared concepts were detected"
    ],
    frameworkHints: family.frameworks,
    matchedPatterns: signals,
    pathSignals: family.sourceFiles.flatMap(extractPathSignals).filter((signal, index, values) => values.indexOf(signal) === index).slice(0, 12),
    diffSignals: [],
    confidenceFactors: [
      `Pattern family discovered from ${family.fileCount} similar source files.`,
      `Pattern family confidence: ${Math.round(family.confidence * 100)}%.`,
      family.similarityScores.length > 0
        ? `Strongest similarity: ${family.similarityScores[0]?.files.join(" + ")} at ${Math.round((family.similarityScores[0]?.score ?? 0) * 100)}%.`
        : "Similarity was inferred from shared family features."
    ],
    falsePositiveNotes: [
      "Fingerprint similarity can group files with similar technology usage but different intent.",
      "Review the representative files before approving this skill."
    ],
    rationale: `Compactor grouped ${family.fileCount} source files into pattern family ${family.name} by implementation fingerprint similarity, independent of co-change history.`,
    generatedFrom: ["pattern_family"],
    patternFamily: {
      id: family.id,
      name: family.name,
      confidence: family.confidence,
      fileCount: family.fileCount,
      commitCount: family.commitCount,
      frameworks: family.frameworks,
      libraries: family.libraries,
      concepts: family.concepts,
      roles: family.roles,
      representativeFiles: family.representativeFiles,
      sourceFiles: family.sourceFiles,
      similarityScores: family.similarityScores,
      reasons: family.reasons
    }
  };
}

function commitsForPatternFamily(commits: CommitMetadata[], family: PatternFamily): CommitMetadata[] {
  const files = new Set(family.sourceFiles.map((file) => path.normalize(file)));
  return commits.filter((commit) => commit.changedFiles.some((file) => files.has(path.normalize(file))));
}

function genericSignalsForPatternFamily(family: PatternFamily): GenericSignal[] {
  const signals: GenericSignal[] = [];
  const has = (value: string) => family.roles.includes(value) || family.concepts.includes(value);
  if (has("ui") || has("component") || has("grid") || has("table")) signals.push("ui_changed", "component_changed");
  if (has("api") || has("controller") || has("route") || has("rest")) signals.push("backend_changed", "api_route_changed", "controller_changed");
  if (has("service")) signals.push("service_layer_changed");
  if (has("repository")) signals.push("repository_or_dao_changed");
  if (has("database") || has("migration") || has("schema") || has("model") || has("entity")) signals.push("db_changed", "model_or_entity_changed");
  if (has("migration") || has("schema")) signals.push("migration_changed", "schema_changed");
  if (has("cli") || has("command") || has("option") || has("flag")) signals.push("cli_command_changed");
  return unique(signals).slice(0, 10);
}

function primaryAreaForPatternFamily(family: PatternFamily): PrimaryArea {
  const has = (value: string) => family.roles.includes(value) || family.concepts.includes(value);
  if (has("ui") || has("component") || has("grid") || has("table")) return "frontend";
  if (has("cli") || has("command") || has("option") || has("flag")) return "cli";
  if (has("api") || has("controller") || has("route") || has("rest")) return "backend";
  if (has("database") || has("migration") || has("schema") || has("model") || has("entity")) return "db";
  return "unknown";
}

function workflowQualityForPatternFamily(family: PatternFamily, validationCommands: string[]): number {
  let score = 0.45;
  if (family.fileCount >= 3) score += 0.15;
  if (family.confidence >= 0.8) score += 0.15;
  if (validationCommands.length > 0) score += 0.15;
  if (family.concepts.length >= 2 || family.roles.length >= 2) score += 0.1;
  return Number(Math.min(0.9, score).toFixed(2));
}

function skillNameForPatternFamily(family: PatternFamily): string {
  const has = (value: string) => family.roles.includes(value) || family.concepts.includes(value) || family.name.toLowerCase().includes(value);
  if (has("grid")) return "Add Grid Component";
  if (has("table")) return "Add Table Component";
  if (has("cli") || has("command")) return "Add CLI Command";
  if (has("controller") || has("api") || has("route")) return "Add REST Controller";
  if (has("migration") || has("schema")) return "Add Database Migration";
  return `Update ${family.name.replace(/\s+Pattern$/, "")}`;
}

function taskDescriptionForPatternFamily(family: PatternFamily, name: string): string {
  const directory = family.directories[0] ?? "the matching source area";
  return `Use this when implementing ${name.toLowerCase()} work that matches the ${family.name} implementation family under ${directory}.`;
}

function genericCategoryForPatternFamily(family: PatternFamily): string {
  const area = primaryAreaForPatternFamily(family);
  if (area === "frontend") return "UI Implementation Family";
  if (area === "backend") return "Backend Implementation Family";
  if (area === "cli") return "CLI Implementation Family";
  if (area === "db") return "Database Implementation Family";
  return "Implementation Pattern Family";
}

function observedConventionsForPatternFamily(family: PatternFamily): string[] {
  return [
    `Similar implementation shape appears across ${family.fileCount} files.`,
    family.frameworks.length > 0 ? `Shared frameworks: ${family.frameworks.join(", ")}.` : "No single framework was required for the family.",
    family.libraries.length > 0 ? `Shared libraries: ${family.libraries.join(", ")}.` : "No single library was required for the family.",
    family.concepts.length > 0 ? `Shared concepts: ${family.concepts.slice(0, 6).join(", ")}.` : "No dominant concepts were detected."
  ];
}

function observedChangesForPatternFamily(family: PatternFamily): string[] {
  return [
    `Fingerprint family ${family.name} contains ${family.fileCount} source files.`,
    ...family.similarityScores.slice(0, 4).map((similarity) => `Similarity ${Math.round(similarity.score * 100)}%: ${similarity.files.join(" + ")} (${similarity.sharedFeatures.slice(0, 4).join(", ")})`)
  ];
}

function buildCandidate(cluster: WorkingCluster, scan: ScanResult, index: number): CandidateSkill {
  const rawCommits = cluster.commits;
  const rawDominant = dominantSignals(cluster, 10);
  const rawEvidenceFiles = filteredEvidenceFiles(rawCommits);
  const repoLearning = scan.repoLearning ?? learnRepositoryPatterns(scan);
  const matchedSurface = matchLearnedSurface(repoLearning, rawCommits, rawEvidenceFiles, rawDominant);
  const rawLearnedSurface = matchedSurface ? enrichLearnedSurface(matchedSurface, rawCommits, rawDominant, scan) : undefined;
  const evidenceSplit = rawLearnedSurface ? splitSurfaceEvidence(rawCommits, rawLearnedSurface) : undefined;
  const commits = evidenceSplit && evidenceSplit.relevantCommits.length > 0 ? evidenceSplit.relevantCommits : rawCommits;
  const candidateCluster = commits === rawCommits ? cluster : clusterFromCommits(commits, repoLearning);
  const dominant = dominantSignals(candidateCluster, 10);
  const learnedSurface = rawLearnedSurface && evidenceSplit && evidenceSplit.relevantCommits.length > 0
    ? {
        ...rawLearnedSurface,
        matchShare: Number((evidenceSplit.surfaceEvidenceCommits.length / evidenceSplit.relevantCommits.length).toFixed(2)),
        roleCounts: roleCountsForFiles(evidenceSplit.relevantFiles),
        coChangeEvidence: surfaceCoChangeEvidence(rawLearnedSurface),
        reasons: [
          ...rawLearnedSurface.reasons,
          `${evidenceSplit.surfaceEvidenceCommits.length} commits directly touched ${rawLearnedSurface.commonDirectory}.`,
          `${evidenceSplit.supportingEvidenceCommits.length} supporting commits touched learned co-changing tests/config/docs.`,
          `${evidenceSplit.rejectedEvidenceCommits.length} broad-cluster commits were rejected as unrelated or generated-artifact noise.`
        ]
      }
    : rawLearnedSurface;
  const strongLearnedSurface = isStrongLearnedSurface(learnedSurface) ? learnedSurface : undefined;
  const strongSurface = Boolean(strongLearnedSurface);
  const termEvidence = refineDomainTermEvidence(computeDomainTermEvidence(commits, scan), commits, dominant);
  const proposal = proposeSkillName(dominant, termEvidence, frameworkHints(commits));
  const patternConfidence = calculatePatternConfidence(candidateCluster, scan.commitsAnalyzed);
  const evidenceFiles = evidenceSplit && learnedSurface ? evidenceSplit.relevantFiles : filteredEvidenceFiles(commits);
  const commonFiles = learnedSurface ? surfaceCommonFiles(evidenceFiles, learnedSurface) : topValues(evidenceFiles, 8);
  const commonDirectories = learnedSurface ? surfaceCommonDirectories(evidenceFiles, learnedSurface) : topValues(evidenceFiles.map(directoryForFile), 6);
  const pathSignals = topValues(learnedSurface ? evidenceFiles.flatMap(extractPathSignals) : commits.flatMap((commit) => commit.pathSignals), 12);
  const diffSignals = topDiffSignalLabels(commits, 12, learnedSurface);
  const surfaceTerms = learnedSurface?.sourceTerms ?? [];
  const finalDomainTerms = strongLearnedSurface ? surfaceDomainTerms(strongLearnedSurface) : proposal.domainTerms;
  const terms = strongLearnedSurface ? surfaceTerms : unique([...termEvidence.repeated, ...(learnedSurface?.repeatedTerms ?? [])]);
  const rawValidationCommands = unique([
    ...(learnedSurface?.validationCommands ?? []),
    ...discoverValidationCommandsForFiles(scan.repoRoot, unique([...commonFiles, ...(learnedSurface?.representativeFiles ?? []), ...(learnedSurface?.coChangingTestFiles ?? [])])),
    ...scan.validationCommands
  ]);
  const validationScopeFiles = unique([...evidenceFiles, ...commonFiles, ...(learnedSurface?.representativeFiles ?? []), ...(learnedSurface?.coChangingTestFiles ?? [])]);
  const validationProfile = scopeValidationCommands(rawValidationCommands, validationScopeFiles, learnedSurface);
  const validationCommands = unique([...validationProfile.primary, ...validationProfile.secondary]);
  const workflowProfile = buildWorkflowProfile(commits, learnedSurface, validationProfile.primary, validationProfile.secondary);
  const taskEvidenceFiles = unique(evidenceFiles);
  const taskArea = effectiveTaskArea(commits, dominant, taskEvidenceFiles, learnedSurface);
  const artifactShare = generatedArtifactEvidenceShare(commits);
  const finalGenericCategory = strongLearnedSurface ? genericCategoryForSurfaceTaskKind(strongLearnedSurface.taskKind ?? "source-workflow") : proposal.genericCategory;
  const finalGenericFallbackName = strongLearnedSurface ? learnedSurfaceTaskName(strongLearnedSurface, dominant) : proposal.genericFallbackName;
  const taskName = generateTaskSkillName(taskArea, dominant, taskEvidenceFiles, finalDomainTerms, finalGenericCategory, learnedSurface);
  const namingAdjustment = adjustedNamingConfidence(proposal.namingConfidence, commits, dominant, taskEvidenceFiles, taskArea, finalGenericCategory, validationCommands, artifactShare, taskName, finalDomainTerms, learnedSurface);
  const promotion = decidePromotion(
    commits,
    dominant,
    taskEvidenceFiles,
    patternConfidence,
    namingAdjustment.confidence,
    finalGenericCategory,
    terms,
    validationCommands,
    taskName,
    taskArea,
    learnedSurface,
    evidenceSplit?.surfaceEvidenceCommits.length,
    workflowProfile
  );
  const namingConfidence = finalNamingConfidence(namingAdjustment.confidence, promotion);
  const candidateName = promotion.promotionLevel === "pattern_candidate"
    ? neutralPatternCandidateName(dominant, promotion.primaryArea, promotion.primaryAreaShare, termEvidence.selected, proposal.genericCategory)
    : taskName;
  const id = uniqueSkillId(candidateName, dominant, index);
  const evidenceCommitSource = evidenceSplit
    ? [
        ...representativeCommits(evidenceSplit.surfaceEvidenceCommits, dominant),
        ...representativeCommits(evidenceSplit.supportingEvidenceCommits, dominant)
      ]
    : representativeCommits(commits, dominant);

  return {
    id,
    name: candidateName,
    taskDescription: generateTaskDescription(candidateName, promotion.primaryArea, commits, dominant, taskEvidenceFiles, finalDomainTerms, finalGenericCategory, learnedSurface),
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
    evidenceCommits: evidenceCommitSource.map((commit) => toEvidenceCommit(commit, learnedSurface)),
    surfaceEvidenceCommits: evidenceSplit?.surfaceEvidenceCommits.map((commit) => toEvidenceCommit(commit, learnedSurface)),
    supportingEvidenceCommits: evidenceSplit?.supportingEvidenceCommits.map((commit) => toEvidenceCommit(commit, learnedSurface)),
    rejectedEvidenceCommits: evidenceSplit?.rejectedEvidenceCommits.map((commit) => toEvidenceCommit(commit)),
    rawEvidenceCommitCount: rawCommits.length,
    surfaceRelevantCommitCount: evidenceSplit?.relevantCommits.length ?? commits.length,
    rejectedEvidenceCommitCount: evidenceSplit?.rejectedEvidenceCommits.length ?? 0,
    commonFiles,
    commonDirectories,
    observedConventions: observedConventions(dominant, commonDirectories, frameworkHints(commits)),
    observedChanges: observedChanges(commits, learnedSurface),
    workflowProfile,
    suggestedValidationCommands: validationCommands,
    genericSignals: dominant,
    repeatedTerms: terms,
    domainTerms: finalDomainTerms,
    rejectedNoisyTerms: proposal.rejectedNoisyTerms,
    genericCategory: finalGenericCategory,
    genericFallbackName: finalGenericFallbackName,
    namingReasons: strongLearnedSurface
      ? [
          `learned surface used for name: ${strongLearnedSurface.displayName} (${strongLearnedSurface.commonDirectory})`,
          `surface task kind selected: ${strongLearnedSurface.taskKind ?? "source-workflow"}`,
          (strongLearnedSurface.sourceTerms ?? []).length > 0
            ? `source-only surface terms used for name: ${(strongLearnedSurface.sourceTerms ?? []).slice(0, 6).join(", ")}`
            : "no source-only domain terms were strong enough for the name",
          ...namingAdjustment.reasons
        ]
      : [...proposal.reasons, ...namingAdjustment.reasons],
    frameworkHints: frameworkHints(commits),
    matchedPatterns: dominant,
    pathSignals,
    diffSignals,
    confidenceFactors: confidenceFactors(candidateCluster, scan.commitsAnalyzed, strongLearnedSurface ? [`learned surface used for name: ${strongLearnedSurface.displayName}`, ...namingAdjustment.reasons] : [...proposal.reasons, ...namingAdjustment.reasons], learnedSurface, rawCommits.length, evidenceSplit?.relevantCommits.length, evidenceSplit?.rejectedEvidenceCommits.length),
    falsePositiveNotes: falsePositiveNotes(dominant, commits, namingConfidence),
    rationale: learnedSurface
      ? `Compactor grouped ${rawCommits.length} broad-cluster commits around learned surface ${learnedSurface.displayName} (${learnedSurface.commonDirectory}); ${evidenceSplit?.relevantCommits.length ?? commits.length} surface-relevant commits were used for the skill.`
      : `Compactor grouped ${commits.length} commits with a repeated change shape: ${dominant.join(", ")}.`,
    generatedFrom: learnedSurface ? ["learned_surface"] : undefined,
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
  if (matchCount === 0) {
    return 0;
  }
  const topSignalConsistency = cluster.signalCounts.size > 0 ? Math.max(...[...cluster.signalCounts.values()]) / matchCount : 0;
  const topDirectoryConsistency = cluster.directoryCounts.size > 0 ? Math.max(...[...cluster.directoryCounts.values()]) / matchCount : 0;
  const frequency = totalCommits === 0 ? 0 : Math.min(matchCount / totalCommits, 1);
  return Number(Math.min(0.97, 0.28 + Math.min(matchCount, 8) * 0.055 + topSignalConsistency * 0.18 + topDirectoryConsistency * 0.12 + frequency * 0.12).toFixed(2));
}

function confidenceFactors(
  cluster: WorkingCluster,
  totalCommits: number,
  namingReasons: string[],
  learnedSurface?: LearnedSurfaceMatch,
  rawCommitCount = cluster.commits.length,
  relevantCommitCount = cluster.commits.length,
  rejectedCommitCount = 0
): string[] {
  const commits = cluster.commits;
  const dominant = dominantSignals(cluster, 6);
  return [
    `${relevantCommitCount} surface-relevant commits were used from ${rawCommitCount} broad-cluster commits (${rejectedCommitCount} rejected as unrelated or generated noise).`,
    `${commits.length} of ${totalCommits} scanned commits matched the filtered repeated change shape.`,
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

function observedChanges(commits: CommitMetadata[], learnedSurface?: LearnedSurfaceMatch): string[] {
  const labels = topDiffSignalLabels(commits, 8, learnedSurface);
  if (labels.length === 0) {
    return ["No structured diff-level changes were detected beyond path signals."];
  }
  return labels.map((label) => `Observed ${label}.`);
}

function scopeValidationCommands(commands: string[], files: string[], learnedSurface?: LearnedSurfaceMatch): { primary: string[]; secondary: string[] } {
  const uniqueCommands = unique(commands);
  if (uniqueCommands.length === 0) {
    return { primary: [], secondary: [] };
  }

  const families = validationFamiliesForFiles(files, learnedSurface);
  const scoped = uniqueCommands.filter((command) => validationCommandMatchesFamilies(command, families));
  const candidates = scoped.length > 0 ? scoped : uniqueCommands.filter((command) => commandFamily(command) === "make");
  const sorted = candidates.sort((a, b) => validationCommandRank(a, families) - validationCommandRank(b, families) || a.localeCompare(b));
  const primary = sorted.filter((command) => isPrimaryValidationCommand(command, families));
  const primaryCommands = primary.length > 0 ? primary : sorted.slice(0, 1);
  const primarySet = new Set(primaryCommands);
  const secondary = sorted.filter((command) => !primarySet.has(command));

  return {
    primary: primaryCommands,
    secondary
  };
}

function validationFamiliesForFiles(files: string[], learnedSurface?: LearnedSurfaceMatch): Set<string> {
  const extensions = new Set([
    ...(learnedSurface?.dominantExtensions ?? []),
    ...files.map((file) => path.extname(file).toLowerCase()).filter(Boolean)
  ]);
  const families = new Set<string>();
  const has = (extension: string) => extensions.has(extension);

  if (has(".rs")) families.add("rust");
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].some(has)) families.add("node");
  if (has(".py")) families.add("python");
  if (has(".go")) families.add("go");
  if (has(".cs")) families.add("dotnet");
  if (has(".java") || has(".kt")) families.add("jvm");

  if (learnedSurface?.taskKind === "commands" && families.size === 0) {
    families.add("node");
  }

  return families;
}

function validationCommandMatchesFamilies(command: string, families: Set<string>): boolean {
  const family = commandFamily(command);
  if (family === "make") {
    return families.size > 0;
  }
  if (families.size === 0) {
    return family !== "python";
  }
  return families.has(family);
}

function commandFamily(command: string): string {
  if (/^cargo\b/.test(command)) return "rust";
  if (/^(npm|pnpm|yarn)\b/.test(command)) return "node";
  if (/^(pytest|python\b)/.test(command)) return "python";
  if (/^go test\b/.test(command)) return "go";
  if (/^dotnet\b/.test(command)) return "dotnet";
  if (/^(mvn|gradle|\.\/gradlew)\b/.test(command)) return "jvm";
  if (/^make\b/.test(command)) return "make";
  return "unknown";
}

function validationCommandRank(command: string, families: Set<string>): number {
  const family = commandFamily(command);
  const isTest = /\btest\b|pytest|unittest/.test(command);
  if (families.has("rust") && command === "cargo test") return 0;
  if (families.has("node") && command === "npm test") return 0;
  if (families.has("python") && /^(pytest|python -m unittest)$/.test(command)) return 0;
  if (families.has("go") && command === "go test ./...") return 0;
  if (families.has("dotnet") && command === "dotnet test") return 0;
  if (families.has("jvm") && /^(mvn test|gradle test|\.\/gradlew test)$/.test(command)) return 0;
  if (family === "make" && command === "make test") return 2;
  if (family === "make" && command === "make build") return 3;
  if (isTest) return 4;
  if (/build|typecheck|lint/.test(command)) return 5;
  return 9;
}

function isPrimaryValidationCommand(command: string, families: Set<string>): boolean {
  if (families.has("rust")) return command === "cargo test";
  if (families.has("node")) return command === "npm test";
  if (families.has("python")) return /^(pytest|python -m unittest)$/.test(command);
  if (families.has("go")) return command === "go test ./...";
  if (families.has("dotnet")) return command === "dotnet test";
  if (families.has("jvm")) return /^(mvn test|gradle test|\.\/gradlew test)$/.test(command);
  return /\btest\b|pytest|unittest/.test(command);
}

function buildWorkflowProfile(commits: CommitMetadata[], learnedSurface: LearnedSurfaceMatch | undefined, primaryValidationCommands: string[], secondaryValidationCommands: string[]): WorkflowProfile | undefined {
  if (!learnedSurface) {
    return undefined;
  }

  const actionMap = new Map<WorkflowAction, { files: Set<string>; commits: Set<string>; groupCounts: Map<WorkflowActionSummary["group"], number>; order: number }>();
  let order = 0;

  for (const commit of commits) {
    const relevantFiles = surfaceRelevantFiles(commit.changedFiles, learnedSurface);
    const fileOrder = orderedWorkflowFiles(commit, relevantFiles);

    for (const file of fileOrder) {
      const summary = commit.diffSummary.files.find((entry) => path.normalize(entry.filePath) === path.normalize(file));
      const group = workflowActionGroup(file, learnedSurface);
      const actions = workflowActionsForFile(file, summary, commit, learnedSurface);

      for (const action of actions) {
        const entry = actionMap.get(action) ?? { files: new Set<string>(), commits: new Set<string>(), groupCounts: new Map(), order: order++ };
        entry.files.add(file);
        entry.commits.add(commit.hash);
        entry.groupCounts.set(group, (entry.groupCounts.get(group) ?? 0) + 1);
        actionMap.set(action, entry);
      }
    }
  }

  const minActionCount = Math.min(2, Math.max(1, Math.ceil(commits.length * 0.35)));
  const actions = [...actionMap.entries()]
    .map(([action, entry]) => ({
      action,
      count: entry.commits.size,
      files: [...entry.files].sort().slice(0, 5),
      commits: [...entry.commits].sort(),
      group: dominantWorkflowGroup(entry.groupCounts),
      order: entry.order
    }))
    .filter((summary) => summary.count >= minActionCount)
    .sort((a, b) => workflowActionPriority(a.action, learnedSurface.taskKind) - workflowActionPriority(b.action, learnedSurface.taskKind) || b.count - a.count || a.order - b.order)
    .map(({ order: _order, ...summary }) => summary);

  const sourceActions = actions.filter((action) => action.group === "source");
  const testActions = actions.filter((action) => action.group === "test");
  const supportingArtifactActions = actions.filter((action) => action.group === "supporting");
  const { coreSteps, supportingSteps } = workflowStepsForActions(actions, learnedSurface, primaryValidationCommands);
  const steps = [...coreSteps, ...supportingSteps];

  return {
    actions,
    sourceActions,
    testActions,
    supportingArtifactActions,
    validationCommands: unique([...primaryValidationCommands, ...secondaryValidationCommands]),
    primaryValidationCommands,
    secondaryValidationCommands,
    steps,
    coreSteps,
    supportingSteps,
    usesGenericFallback: steps.length === 0
  };
}

function orderedWorkflowFiles(commit: CommitMetadata, relevantFiles: string[]): string[] {
  const diffOrder = commit.diffSummary.files.map((file) => path.normalize(file.filePath));
  return unique([
    ...diffOrder.filter((file) => relevantFiles.includes(file)),
    ...relevantFiles
  ]);
}

function workflowActionGroup(filePath: string, learnedSurface: LearnedSurfaceMatch): WorkflowActionSummary["group"] {
  if (isTestFile(filePath)) {
    return "test";
  }

  if (learnedSurface.taskKind === "docs" && fileDirectlyTouchesSurface(filePath, learnedSurface) && inferFileRole(filePath) === "docs") {
    return "source";
  }

  if (fileSupportsSurface(filePath, learnedSurface) || inferFileRole(filePath) === "docs" || inferFileRole(filePath) === "config" || inferFileRole(filePath) === "fixture") {
    return "supporting";
  }

  return "source";
}

function workflowActionsForFile(filePath: string, summary: FileDiffSummary | undefined, commit: CommitMetadata, learnedSurface: LearnedSurfaceMatch): WorkflowAction[] {
  const normalized = path.normalize(filePath);
  if (isNoisyEvidenceFile(normalized)) {
    return [];
  }

  const actions = new Set<WorkflowAction>();
  const role = inferFileRole(normalized);
  const signals = [
    ...(summary?.signals ?? []),
    ...commit.diffSummary.signals.filter((signal) => path.normalize(signal.filePath) === normalized)
  ];
  const signalTypes = new Set(signals.map((signal) => signal.type));
  const text = `${normalized} ${commit.message} ${signals.map((signal) => signal.value).join(" ")}`.toLowerCase();
  const hasChangedLines = !summary || summary.addedLineCount > 0 || summary.deletedLineCount > 0;

  if (isTestFile(normalized)) actions.add("added_test_case");
  if (role === "docs") actions.add("updated_docs");
  if (role === "fixture") actions.add("updated_fixture");
  if (summary?.changedPackageScripts.length || signalTypes.has("package_script_changed")) actions.add("changed_package_script");
  if (summary?.addedConfigKeys.length || signalTypes.has("config_changed")) actions.add("changed_config_key");
  if (summary?.addedCliOptions.length || signals.some((signal) => signal.type === "cli_command_changed" && /^--/.test(signal.value))) actions.add("added_cli_option");
  if (signals.some((signal) => signal.type === "cli_command_changed" && !/^--/.test(signal.value)) && learnedSurface.taskKind === "commands") actions.add("changed_cli_option");
  if (summary?.addedRoutes.length || signalTypes.has("api_route_changed") || signalTypes.has("controller_changed")) actions.add("added_route_or_handler");
  if (signalTypes.has("schema_changed") || signalTypes.has("model_or_entity_changed") || /(^|\/)(models?|entities?|schema)(\/|\.|$)/i.test(normalized)) actions.add("changed_schema_or_model");
  if (signalTypes.has("query_changed") || signalTypes.has("migration_changed") || /(^|\/)(migrations?|queries?)(\/|$)|\.(sql|prisma)$/i.test(normalized)) actions.add("changed_query_or_migration");
  if (signalTypes.has("validation_changed") || /(validat|schema|zod|yup)/i.test(text)) actions.add("changed_validation_logic");
  if (/(error|errors|exception|failure|fail|panic|throw|catch)/i.test(text)) actions.add("changed_error_handling");
  if (/(output|format|formatter|print|render|display|serialize|export)/i.test(text)) actions.add("changed_output_formatting");
  if (isApiClientFile(normalized, learnedSurface)) actions.add("updated_api_client");
  if (isUiComponentFile(normalized, learnedSurface)) actions.add("updated_component");
  if (isStyleFile(normalized)) actions.add("updated_style");
  if (summary && (summary.addedFunctions.length > 0 || signalTypes.has("function_added"))) actions.add("added_function");
  if (summary && (summary.addedClasses.length > 0 || summary.addedInterfacesOrTypes.length > 0 || summary.addedEnums.length > 0 || signalTypes.has("class_added") || signalTypes.has("interface_or_type_added") || signalTypes.has("enum_added"))) {
    actions.add("added_type_or_interface");
  }
  if (hasChangedLines && role === "source" && workflowActionGroup(normalized, learnedSurface) === "source" && !isStyleFile(normalized)) actions.add("modified_function");

  return [...actions];
}

function isApiClientFile(filePath: string, learnedSurface: LearnedSurfaceMatch): boolean {
  const lower = filePath.toLowerCase();
  if (learnedSurface.taskKind === "api") {
    return /(^|\/)(clients?|sdk|contracts?)(\/|$)|api[-_.]?client/.test(lower);
  }
  return /(^|\/)(api|client|clients|services)\/|(^|\/)(api|client|clients|services)\.(tsx?|jsx?)$|\/api\.(tsx?|jsx?)$|api[-_.]?client/.test(lower);
}

function isUiComponentFile(filePath: string, learnedSurface: LearnedSurfaceMatch): boolean {
  const lower = filePath.toLowerCase();
  return learnedSurface.taskKind === "ui" && /\.(tsx?|jsx?|vue|svelte|html)$/.test(lower) && /(^|\/)(components?|pages?|screens?|views?)(\/|$)/.test(lower);
}

function isStyleFile(filePath: string): boolean {
  return /\.(css|scss|sass|less)$/i.test(filePath);
}

function dominantWorkflowGroup(counts: Map<WorkflowActionSummary["group"], number>): WorkflowActionSummary["group"] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || workflowGroupPriority(a[0]) - workflowGroupPriority(b[0]))[0]?.[0] ?? "source";
}

function workflowGroupPriority(group: WorkflowActionSummary["group"]): number {
  return group === "source" ? 0 : group === "test" ? 1 : 2;
}

function workflowActionPriority(action: WorkflowAction, kind: SurfaceTaskKind | undefined): number {
  const priorities: Record<WorkflowAction, number> = {
    added_cli_option: kind === "commands" ? 0 : 4,
    changed_cli_option: kind === "commands" ? 1 : 5,
    added_route_or_handler: kind === "api" ? 0 : 6,
    updated_component: kind === "ui" ? 0 : 6,
    updated_api_client: kind === "ui" ? 1 : 7,
    changed_schema_or_model: kind === "database" || kind === "api" ? 2 : 8,
    changed_query_or_migration: kind === "database" ? 1 : 8,
    changed_validation_logic: 3,
    modified_function: 4,
    added_function: 5,
    added_type_or_interface: 6,
    changed_error_handling: 7,
    changed_output_formatting: 8,
    updated_style: kind === "ui" ? 4 : 9,
    changed_config_key: 10,
    changed_package_script: 11,
    added_test_case: 12,
    updated_fixture: 13,
    updated_docs: kind === "docs" ? 0 : 14
  };
  return priorities[action] ?? 99;
}

function workflowStepsForActions(actions: WorkflowActionSummary[], learnedSurface: LearnedSurfaceMatch, primaryValidationCommands: string[]): { coreSteps: WorkflowStepEvidence[]; supportingSteps: WorkflowStepEvidence[] } {
  const coreSteps = actions
    .filter((action) => isCoreWorkflowAction(action, learnedSurface))
    .map((action) => workflowStepForAction(action, learnedSurface, "core"))
    .filter((step): step is WorkflowStepEvidence => Boolean(step))
    .slice(0, 5);
  const coreActionKeys = new Set(coreSteps.map((step) => step.action));
  const supportingSteps = actions
    .filter((action) => !isCoreWorkflowAction(action, learnedSurface))
    .filter((action) => !coreActionKeys.has(action.action))
    .map((action) => workflowStepForAction(action, learnedSurface, "supporting"))
    .filter((step): step is WorkflowStepEvidence => Boolean(step))
    .slice(0, 5);

  if (primaryValidationCommands.length > 0 && coreSteps.length > 0) {
    coreSteps.push({
      action: "validation",
      text: "Run the primary validation command(s).",
      count: primaryValidationCommands.length,
      files: primaryValidationCommands,
      tier: "core"
    });
  }

  return { coreSteps, supportingSteps };
}

function isCoreWorkflowAction(summary: WorkflowActionSummary, learnedSurface: LearnedSurfaceMatch): boolean {
  const kind = learnedSurface.taskKind ?? "source-workflow";
  if (kind === "docs") {
    return summary.action === "updated_docs";
  }
  if (kind === "config") {
    return summary.action === "changed_config_key" || summary.action === "changed_package_script";
  }
  if (summary.group === "supporting") {
    return false;
  }

  if (kind === "commands") {
    return [
      "added_cli_option",
      "changed_cli_option",
      "modified_function",
      "added_function",
      "changed_error_handling",
      "changed_output_formatting",
      "added_test_case"
    ].includes(summary.action);
  }

  if (kind === "ui") {
    return ["updated_component", "updated_api_client", "updated_style", "modified_function", "changed_error_handling", "changed_output_formatting", "added_test_case"].includes(summary.action);
  }

  if (kind === "api") {
    return ["added_route_or_handler", "changed_schema_or_model", "updated_api_client", "changed_validation_logic", "changed_error_handling", "modified_function", "added_test_case"].includes(summary.action);
  }

  if (kind === "database") {
    return ["changed_query_or_migration", "changed_schema_or_model", "added_test_case"].includes(summary.action);
  }

  return summary.group === "source" || summary.group === "test";
}

function workflowStepForAction(summary: WorkflowActionSummary, learnedSurface: LearnedSurfaceMatch, tier: "core" | "supporting"): WorkflowStepEvidence | undefined {
  const kind = learnedSurface.taskKind ?? "source-workflow";
  const stepText = tier === "core"
    ? workflowStepText(summary.action, kind)
    : supportingWorkflowStepText(summary.action, kind);
  if (!stepText) {
    return undefined;
  }

  return {
    action: summary.action,
    text: stepText,
    count: summary.count,
    files: summary.files.slice(0, 3),
    tier
  };
}

function supportingWorkflowStepText(action: WorkflowAction, kind: SurfaceTaskKind): string | undefined {
  if (action === "updated_docs") {
    if (kind === "commands") {
      return "Update docs/help text only if the command's user-facing behavior changes.";
    }
    return "Update documentation only if the user-facing behavior changes.";
  }
  if (action === "changed_config_key") {
    return "Update configuration only if the source change requires it.";
  }
  if (action === "changed_package_script") {
    return "Update package scripts only if validation or developer workflow changes.";
  }
  if (action === "updated_fixture") {
    return "Update fixtures only when source behavior or output changes.";
  }
  if (action === "updated_style") {
    return "Update styles only when the visible UI behavior changes.";
  }
  return undefined;
}

function workflowStepText(action: WorkflowAction, kind: SurfaceTaskKind): string | undefined {
  const generic: Partial<Record<WorkflowAction, string>> = {
    added_function: "Add helper functions only where repeated examples introduce new behavior.",
    modified_function: "Update source behavior in the learned surface.",
    added_type_or_interface: "Update shared types or interfaces used by the surface.",
    changed_validation_logic: "Update validation logic alongside the source behavior.",
    changed_error_handling: "Update error handling paths for the changed behavior.",
    changed_output_formatting: "Update output formatting where the surface renders or prints results.",
    changed_config_key: "Update configuration keys that directly support this surface.",
    changed_package_script: "Update package scripts only when the surface workflow requires it.",
    updated_docs: "Update documentation that directly describes this surface.",
    updated_fixture: "Update fixtures that directly support the changed behavior.",
    added_test_case: "Add or update tests that cover the changed behavior."
  };

  if (kind === "commands") {
    const commandSteps: Partial<Record<WorkflowAction, string>> = {
      added_cli_option: "Add or update command option parsing in the command module.",
      changed_cli_option: "Update command dispatch, arguments, or option handling.",
      modified_function: "Update command handler behavior in the learned command files.",
      added_function: "Add command helper functions only when repeated examples do so.",
      added_test_case: "Add or update command tests for the changed option or behavior.",
      updated_fixture: "Update command fixtures only when output or behavior changes.",
      changed_output_formatting: "Update command output formatting when examples change printed results.",
      changed_error_handling: "Update command error handling for invalid input or failed execution."
    };
    return commandSteps[action] ?? generic[action];
  }

  if (kind === "ui") {
    const uiSteps: Partial<Record<WorkflowAction, string>> = {
      updated_component: "Update component, screen, or view behavior in the learned UI surface.",
      updated_api_client: "Update API/client wiring used by the UI surface.",
      updated_style: "Update styles that repeatedly co-change with this UI surface.",
      added_test_case: "Add or update UI tests that cover the changed behavior.",
      modified_function: "Update UI source behavior in the learned surface.",
      changed_output_formatting: "Update display or rendering behavior when examples show formatting changes.",
      changed_error_handling: "Update UI error states when examples show error handling changes."
    };
    return uiSteps[action] ?? generic[action];
  }

  if (kind === "api") {
    const apiSteps: Partial<Record<WorkflowAction, string>> = {
      added_route_or_handler: "Update route, controller, or handler behavior in the learned API surface.",
      changed_schema_or_model: "Update schema or model code only when it co-changes with the API behavior.",
      updated_api_client: "Update client contract or API client wiring when it co-changes.",
      changed_validation_logic: "Update request validation alongside the API behavior.",
      changed_error_handling: "Update API error handling for the changed route or handler.",
      added_test_case: "Add or update API tests that cover the changed behavior.",
      modified_function: "Update API source behavior in the learned surface."
    };
    return apiSteps[action] ?? generic[action];
  }

  if (kind === "database") {
    const databaseSteps: Partial<Record<WorkflowAction, string>> = {
      changed_query_or_migration: "Update migrations or queries in the learned database surface.",
      changed_schema_or_model: "Update schema, model, or entity code together.",
      added_test_case: "Add or update tests that cover the database-backed behavior."
    };
    return databaseSteps[action] ?? generic[action];
  }

  if (kind === "docs") {
    return action === "updated_docs" ? "Update the documentation files in this learned docs surface." : generic[action];
  }

  return generic[action];
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

function toEvidenceCommit(commit: CommitMetadata, learnedSurface?: LearnedSurfaceMatch): EvidenceCommit {
  const changedFiles = learnedSurface
    ? surfaceRelevantFiles(commit.changedFiles, learnedSurface)
    : nonNoisyFiles(commit.changedFiles);
  const evidenceFiles = changedFiles.length > 0 ? changedFiles : commit.changedFiles;
  return {
    hash: commit.hash,
    shortHash: commit.shortHash,
    message: commit.message,
    changedFiles: evidenceFiles,
    diffSignals: commit.diffSummary.signals
      .filter((signal) => !isNoisyEvidenceFile(signal.filePath))
      .filter((signal) => !learnedSurface || fileDirectlyTouchesSurface(signal.filePath, learnedSurface) || fileSupportsSurface(signal.filePath, learnedSurface))
      .slice(0, 6)
      .map((signal) => `${signal.type}:${signal.value} (${signal.filePath})`),
    pathSignals: topValues(evidenceFiles.flatMap(extractPathSignals), 8),
    url: commit.commitUrl
  };
}

function surfaceRelevantFiles(files: string[], surface: LearnedSurfaceMatch): string[] {
  return unique(files.map((file) => path.normalize(file)))
    .filter((file) => !isNoisyEvidenceFile(file))
    .filter((file) => fileDirectlyTouchesSurface(file, surface) || fileSupportsSurface(file, surface) || fileCanSupportSurfaceWorkflow(file, surface))
    .sort((a, b) => surfaceFileRank(a, surface) - surfaceFileRank(b, surface) || a.localeCompare(b));
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
  const surfaceName = learnedSurface ? learnedSurfaceTaskName(learnedSurface, signals) : "";
  if (surfaceName && shouldPreferSurfaceTaskName(learnedSurface, area, genericCategory, signals)) {
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

function shouldPreferSurfaceTaskName(learnedSurface: LearnedSurfaceMatch | undefined, area: PrimaryArea, genericCategory: string, signals: GenericSignal[]): boolean {
  if (isStrongLearnedSurface(learnedSurface)) {
    return learnedSurface.taskKind !== "source-workflow" || (learnedSurface.sourceTerms ?? []).length > 0 || learnedSurface.confidence >= 0.8;
  }

  if (area === "unknown" || area === "mixed" || area === "tests") {
    return true;
  }
  if (/Repeated Engineering|Full-Stack|Change Pattern|Frontend Change|Backend Pattern|Configuration or Infrastructure/.test(genericCategory)) {
    return true;
  }
  const nonTestSignals = signals.filter((signal) => !isTestSignal(signal));
  return nonTestSignals.length === 0;
}

function learnedSurfaceTaskName(surface: LearnedSurfaceMatch, signals: GenericSignal[]): string {
  const kind = surface.taskKind ?? inferSurfaceTaskKind(surface, signals);
  const strongCommandSignal = signals.includes("cli_command_changed");
  const domainTerms = surfaceDomainTerms(surface).slice(0, 2);
  const domain = domainTerms.map(domainTermToTitle).join(" ");

  switch (kind) {
    case "commands":
      return strongCommandSignal ? "Add CLI Command" : "Update Commands";
    case "ui":
      if (domainTerms.some((term) => ["grid", "table", "columns", "column"].includes(term))) {
        return "Update Grid UI";
      }
      if (domainTerms.some((term) => ["report", "reporting", "reports"].includes(term))) {
        return "Update Reporting UI";
      }
      return domain ? `Update ${domain} UI` : "Update UI";
    case "api":
      return domain ? `Update ${domain} API Behavior` : "Update API Behavior";
    case "database":
      return domain ? `Update ${domain} Database Schema` : "Update Database Schema";
    case "config":
      return domain ? `Update ${domain} Runtime Configuration` : "Update Runtime Configuration";
    case "docs":
      return domain ? `Update ${domain} Documentation` : "Update Documentation";
    case "tests":
      return domain ? `Update ${domain} Tests` : "Update Tests";
    default: {
      const base = surfaceBaseName(surface);
      return domain && !base.toLowerCase().includes(domain.toLowerCase()) ? `Update ${domain} ${base} Workflow` : `Update ${base} Workflow`;
    }
  }
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
  if (learnedSurface && shouldPreferSurfaceTaskDescription(learnedSurface, primaryAreaValue, genericCategory, signals)) {
    const examples = learnedSurface.representativeFiles.slice(0, 2).map((file) => path.basename(file).replace(/\.[^.]+$/i, "")).join(", ");
    return `Use this for changes to the learned ${learnedSurface.displayName} under ${learnedSurface.commonDirectory}${examples ? `, including examples like ${examples}` : ""}.`;
  }

  const area = primaryAreaValue === "mixed" || primaryAreaValue === "unknown"
    ? effectiveTaskArea(commits, signals, commonFiles, learnedSurface)
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

function shouldPreferSurfaceTaskDescription(surface: LearnedSurfaceMatch | undefined, area: PrimaryArea, genericCategory: string, signals: GenericSignal[]): boolean {
  return shouldPreferSurfaceTaskName(surface, area, genericCategory, signals) || /Surface$/.test(genericCategory);
}

function effectiveTaskArea(commits: CommitMetadata[], signals: GenericSignal[], commonFiles: string[], learnedSurface?: LearnedSurfaceMatch): PrimaryArea {
  if (isStrongLearnedSurface(learnedSurface)) {
    const surfaceArea = primaryAreaForSurfaceTaskKind(learnedSurface.taskKind ?? inferSurfaceTaskKind(learnedSurface, signals));
    if (surfaceArea !== "unknown") {
      return surfaceArea;
    }
  }

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

  if (artifactShare > AGENT_READY_MAX_ARTIFACT_SHARE && !(isStrongLearnedSurface(learnedSurface) && artifactShare <= 0.5)) {
    const capped = Math.min(confidence, 0.7);
    if (capped < confidence) {
      reasons.push("naming confidence capped at 70% because generated artifacts are a large share of the evidence");
      confidence = capped;
    }
  } else if (artifactShare > AGENT_READY_MAX_ARTIFACT_SHARE && isStrongLearnedSurface(learnedSurface)) {
    reasons.push("generated artifacts were secondary to a strong learned source surface, so they did not drive the name");
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
  if (isNoisyEvidenceFile(filePath) || isTestFile(filePath)) {
    return false;
  }

  if (!learnedSurface) {
    return isSourceFile(filePath);
  }

  return isSurfaceImplementationEvidence(filePath, learnedSurface.taskKind ?? "source-workflow") && fileBelongsToLearnedSurfaceMatch(filePath, learnedSurface);
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
  learnedSurface?: LearnedSurfaceMatch,
  surfaceEvidenceCommitCount?: number,
  workflowProfile?: WorkflowProfile
): PromotionDecision {
  const primary = primaryArea(commits);
  const workflowQuality = calculateWorkflowQuality(commits, dominantSignals, evidenceFiles, validationCommands, learnedSurface, workflowProfile);
  const artifactShare = generatedArtifactEvidenceShare(commits);
  const representativeFileCount = representativeSourceTestFiles(evidenceFiles, learnedSurface).length;
  const taskSupport = taskEvidenceSupport(taskArea, genericCategory, evidenceFiles, dominantSignals, validationCommands, learnedSurface);
  const hasWorkflow = workflowQuality >= DRAFT_WORKFLOW_QUALITY
    && (workflowProfile ? workflowProfile.coreSteps.length > 0 && !workflowProfile.usesGenericFallback : actionableWorkflowKind(genericCategory, taskArea, terms, learnedSurface) !== "unknown")
    && taskSupport.hasTaskSourceEvidence;
  const hasJunkName = hasObviousJunkName(proposedTaskName);
  const surfaceConfidence = learnedSurface?.confidence ?? 0;
  const surfaceShare = learnedSurface?.matchShare ?? 0;
  const strongSurface = isStrongLearnedSurface(learnedSurface);
  const thresholdCommitCount = learnedSurface ? (surfaceEvidenceCommitCount ?? commits.length) : commits.length;
  const promotionPrimaryShare = strongSurface ? Math.max(primary.share, surfaceShare) : primary.share;
  const promotionArtifactShare = strongSurface ? Math.min(artifactShare, 0.2) : artifactShare;
  const agentReadyFailures = thresholdFailures({
    commitCount: thresholdCommitCount,
    patternConfidence,
    namingConfidence,
    primaryShare: promotionPrimaryShare,
    surfaceConfidence,
    surfaceShare,
    artifactShare: promotionArtifactShare,
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
      primaryAreaShare: promotionPrimaryShare,
      workflowQuality,
      generatedArtifactEvidenceShare: artifactShare,
      reasons: ["Promoted to agent-ready skill."],
      reviewNotes
    };
  }

  const draftFailures = thresholdFailures({
    commitCount: thresholdCommitCount,
    patternConfidence,
    namingConfidence,
    primaryShare: promotionPrimaryShare,
    surfaceConfidence,
    surfaceShare,
    artifactShare: promotionArtifactShare,
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
      primaryAreaShare: promotionPrimaryShare,
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
  learnedSurface?: LearnedSurfaceMatch,
  workflowProfile?: WorkflowProfile
): number {
  if (workflowProfile) {
    let score = 0;
    const repeatedActions = workflowProfile.actions.filter((action) => action.count >= 2);
    if (repeatedActions.length >= 3) score += 0.25;
    else if (repeatedActions.length >= 2) score += 0.18;
    else if (repeatedActions.length >= 1) score += 0.1;
    if (workflowProfile.sourceActions.length > 0) score += 0.2;
    if (workflowProfile.testActions.length > 0) score += 0.2;
    if (workflowProfile.primaryValidationCommands.length > 0 || validationCommands.length > 0) score += 0.15;
    if (workflowProfile.coreSteps.length >= 3 && !workflowProfile.usesGenericFallback) score += 0.15;
    else if (workflowProfile.coreSteps.length > 0 && !workflowProfile.usesGenericFallback) score += 0.08;
    if (commits.length >= 3) score += 0.05;
    if (workflowProfile.usesGenericFallback) score -= 0.2;
    if (generatedArtifactEvidenceShare(commits) > 0.35) score -= 0.15;
    return Number(Math.max(0, Math.min(1, score)).toFixed(2));
  }

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

function topDiffSignalLabels(commits: CommitMetadata[], limit: number, learnedSurface?: LearnedSurfaceMatch): string[] {
  return topValues(
    commits.flatMap((commit) => commit.diffSummary.signals
      .filter((signal) => !isNoisyEvidenceFile(signal.filePath))
      .filter((signal) => !learnedSurface || fileDirectlyTouchesSurface(signal.filePath, learnedSurface) || fileSupportsSurface(signal.filePath, learnedSurface))
      .map((signal) => `${signal.type}:${signal.value} (${signal.filePath})`)),
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
