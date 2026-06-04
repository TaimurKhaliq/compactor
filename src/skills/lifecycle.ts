import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CandidateSkill,
  CommitMetadata,
  EvidenceCommit,
  ScanResult,
  SkillLifecycleReport,
  SkillMetadata,
  SkillPatternSignature,
  SkillStatus,
  SkillValidationSummary
} from "../types.js";

interface LifecycleOptions {
  now?: string;
  staleCommitThreshold?: number;
}

interface Evaluation {
  status: SkillStatus;
  supportingCommits: EvidenceCommit[];
  validationWarnings: string[];
  driftReasons: string[];
  newCommits: CommitMetadata[];
}

const DEFAULT_STALE_COMMIT_THRESHOLD = 10;
const BANNER_END = "---";

export function createSkillMetadata(scan: ScanResult, candidate: CandidateSkill, now = new Date().toISOString()): SkillMetadata {
  return {
    skill_id: candidate.id,
    name: candidate.name,
    task_description: candidate.taskDescription,
    created_at: now,
    generated_from_head: currentHead(scan),
    evidence_commits: candidate.evidenceCommits.slice(0, 20),
    pattern_signature: buildPatternSignature(candidate),
    generic_signals: stableUnique(candidate.genericSignals),
    dominant_terms: stableUnique([...candidate.domainTerms, ...candidate.repeatedTerms]).slice(0, 10),
    validation_commands: stableUnique(candidate.suggestedValidationCommands),
    pattern_confidence: candidate.patternConfidence,
    naming_confidence: candidate.namingConfidence,
    promotion_level: candidate.promotion_level,
    workflow_quality: candidate.workflowQuality,
    status: candidate.promotion_level === "draft" ? "draft" : "fresh",
    last_refreshed_at: now,
    managed_by: "compactor",
    human_approved: false,
    validation_warnings: [],
    drift_reasons: []
  };
}

export function buildPatternSignature(candidate: CandidateSkill): SkillPatternSignature {
  const signature: Omit<SkillPatternSignature, "hash"> = {
    generic_signals: stableUnique(candidate.genericSignals),
    common_directories: stableUnique(candidate.commonDirectories).slice(0, 8),
    repeated_file_terms: stableUnique(candidate.repeatedTerms).slice(0, 10),
    dominant_domain_terms: stableUnique(candidate.domainTerms).slice(0, 8),
    validation_commands: stableUnique(candidate.suggestedValidationCommands)
  };

  return {
    hash: stableHash(signature),
    ...signature
  };
}

export function writeSkillMetadata(skillDir: string, metadata: SkillMetadata, preserveExisting = false): string {
  mkdirSync(skillDir, { recursive: true });
  const metadataPath = join(skillDir, "metadata.json");
  if (preserveExisting && existsSync(metadataPath)) {
    copyFileSync(metadataPath, join(skillDir, `metadata.previous-${safeTimestamp(new Date().toISOString())}.json`));
  }
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
  return metadataPath;
}

export function readSkillMetadata(repoRoot: string): SkillMetadata[] {
  return readMetadataFromDir(join(repoRoot, ".compactor", "skills"));
}

export function readDraftSkillMetadata(repoRoot: string): SkillMetadata[] {
  return readMetadataFromDir(join(repoRoot, ".compactor", "draft-skills"));
}

function readMetadataFromDir(directory: string): SkillMetadata[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const metadataPath = join(directory, entry.name, "metadata.json");
      if (!existsSync(metadataPath)) {
        return [];
      }
      return [JSON.parse(readFileSync(metadataPath, "utf8")) as SkillMetadata];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function renderSkillBanner(metadata: SkillMetadata): string {
  const lines = [
    `Status: ${metadata.status}`,
    `Generated from HEAD: ${metadata.generated_from_head}`,
    `Last refreshed: ${metadata.last_refreshed_at}`,
    `Evidence commits: ${metadata.evidence_commits.length}`
  ];

  if (metadata.human_approved) {
    lines.push(`Human approved: true${metadata.approved_at ? ` (${metadata.approved_at})` : ""}`);
  }

  if (metadata.status === "draft" || metadata.promotion_level === "draft") {
    lines.push("This is a generated draft skill. It may help an agent, but it requires human review before being treated as trusted project guidance.");
  }

  if (metadata.status === "stale" || metadata.status === "drifting") {
    lines.push("Warning: This skill may no longer reflect current repo patterns. Run compactor refresh or review before using.");
  }

  if (metadata.status === "deprecated") {
    lines.push("Warning: This skill is deprecated. Do not use it unless a human reviewer re-approves it.");
  }

  return [...lines, BANNER_END, ""].join("\n");
}

export function applySkillBanner(markdown: string, metadata: SkillMetadata): string {
  return `${renderSkillBanner(metadata)}${stripSkillBanner(markdown)}`;
}

export function refreshSkills(scan: ScanResult, options: LifecycleOptions = {}): SkillLifecycleReport {
  const now = options.now ?? new Date().toISOString();
  const metadata = readSkillMetadata(scan.repoRoot);
  const updated = metadata.map((skill) => {
    const evaluation = evaluateSkill(scan, skill, options);
    const next = refreshedMetadata(scan, skill, evaluation, now);
    const skillDir = join(scan.repoRoot, ".compactor", "skills", skill.skill_id);
    writeSkillMetadata(skillDir, next, true);
    refreshSkillMarkdownBanner(skillDir, next);
    return next;
  });

  writeFileSync(join(scan.repoRoot, ".compactor", "AGENTS.md"), renderAgentsMarkdownFromMetadata(scan, updated), "utf8");
  return buildLifecycleReport(scan, updated, options);
}

export function validateSkills(scan: ScanResult, options: LifecycleOptions = {}): SkillLifecycleReport {
  return buildLifecycleReport(scan, readSkillMetadata(scan.repoRoot), options);
}

export function approveSkill(repoRoot: string, skillId: string, now = new Date().toISOString()): SkillMetadata {
  const draft = findDraftSkillMetadata(repoRoot, skillId);
  if (draft) {
    return approveDraftSkill(repoRoot, draft, now);
  }

  const metadata = requireSkillMetadata(repoRoot, skillId);
  const updated: SkillMetadata = {
    ...metadata,
    human_approved: true,
    approved_at: now,
    status: "fresh",
    promotion_level: "agent_ready",
    last_refreshed_at: now
  };
  const skillDir = join(repoRoot, ".compactor", "skills", metadata.skill_id);
  writeSkillMetadata(skillDir, updated, true);
  refreshSkillMarkdownBanner(skillDir, updated);
  return updated;
}

function approveDraftSkill(repoRoot: string, metadata: SkillMetadata, now: string): SkillMetadata {
  const draftDir = join(repoRoot, ".compactor", "draft-skills", metadata.skill_id);
  const skillDir = join(repoRoot, ".compactor", "skills", metadata.skill_id);
  if (existsSync(skillDir)) {
    throw new Error(`Cannot approve draft because a skill already exists with id: ${metadata.skill_id}`);
  }

  mkdirSync(join(repoRoot, ".compactor", "skills"), { recursive: true });
  renameSync(draftDir, skillDir);

  const updated: SkillMetadata = {
    ...metadata,
    human_approved: true,
    approved_at: now,
    status: "fresh",
    promotion_level: "agent_ready",
    last_refreshed_at: now
  };
  writeSkillMetadata(skillDir, updated, true);
  refreshSkillMarkdownBanner(skillDir, updated);
  return updated;
}

export function deprecateSkill(repoRoot: string, skillId: string, now = new Date().toISOString()): SkillMetadata {
  const metadata = requireSkillMetadata(repoRoot, skillId);
  const updated: SkillMetadata = {
    ...metadata,
    status: "deprecated",
    last_refreshed_at: now,
    drift_reasons: stableUnique([...(metadata.drift_reasons ?? []), "Skill was manually deprecated."])
  };
  const skillDir = join(repoRoot, ".compactor", "skills", metadata.skill_id);
  writeSkillMetadata(skillDir, updated, true);
  refreshSkillMarkdownBanner(skillDir, updated);
  return updated;
}

export function renderLifecycleReport(report: SkillLifecycleReport): string {
  return [
    "Compactor Skill Lifecycle Report",
    "",
    `Current HEAD: ${report.currentHead}`,
    `Fresh skills: ${report.fresh.length}`,
    `Stale skills: ${report.stale.length}`,
    `Drifting skills: ${report.drifting.length}`,
    `Deprecated skills: ${report.deprecated.length}`,
    `Validation command changes: ${report.validationCommandChanges.length}`,
    "",
    "Fresh skills:",
    ...renderSummaryList(report.fresh),
    "",
    "Stale skills:",
    ...renderSummaryList(report.stale),
    "",
    "Drifting skills:",
    ...renderSummaryList(report.drifting),
    "",
    "Deprecated candidates:",
    ...renderSummaryList(report.deprecated),
    "",
    "Validation command changes:",
    ...renderSummaryList(report.validationCommandChanges),
    "",
    "Suggested human review:",
    ...renderSummaryList(report.suggestedHumanReview),
    ""
  ].join("\n");
}

export function renderAgentsMarkdownFromMetadata(scan: ScanResult, metadata: SkillMetadata[], patternCandidates: CandidateSkill[] = []): string {
  const active = metadata.filter((skill) => skill.status !== "deprecated" && skill.status !== "draft" && (skill.promotion_level === "agent_ready" || skill.status === "fresh" || skill.human_approved));
  const drafts = metadata.filter((skill) => skill.status !== "deprecated" && (skill.status === "draft" || skill.promotion_level === "draft") && !skill.human_approved);
  const needsReview = metadata.filter((skill) => skill.status !== "deprecated" && skill.status !== "draft" && (skill.status === "stale" || skill.status === "drifting") && !skill.human_approved);

  const activeLines =
    active.length === 0
      ? ["- No agent-ready skills were generated. Review draft skills and pattern candidates before creating trusted guidance."]
      : active.map(
          (skill) =>
            `- ${skill.name}: ${metadataTaskDescription(skill)} Use .compactor/skills/${skill.skill_id}/SKILL.md.`
        );

  const draftLines =
    drafts.length === 0
      ? ["- None"]
      : drafts.map((skill) => `- ${skill.name}: ${metadataTaskDescription(skill)} Review .compactor/draft-skills/${skill.skill_id}/SKILL.md before approving.`);

  const patternLines =
    patternCandidates.length === 0
      ? ["- None"]
      : patternCandidates.map((candidate) => `- ${candidate.name}: review .compactor/patterns/${candidate.id}/PATTERN.md.`);

  const reviewLines =
    needsReview.length === 0
      ? ["- None"]
      : needsReview.map((skill) => `- ${skill.name} (${skill.status}): review .compactor/skills/${skill.skill_id}/SKILL.md before using.`);

  return [
    "# Compactor Draft Repo Guidance",
    "",
    "This draft was generated from local git history. Review it before copying guidance into a production AGENTS.md.",
    "",
    "## Repository guidance",
    "- Start from the nearest existing implementation before introducing a new pattern.",
    "- Match work to generated skills by task description, relevant examples, and representative evidence commits.",
    "- Run only validation commands that exist in this repository.",
    "",
    "## Approved / agent-ready skills",
    ...activeLines,
    "",
    "## Draft skills needing review",
    ...draftLines,
    "",
    "## Skills needing review",
    ...reviewLines,
    "",
    "## Pattern candidates",
    ...patternLines,
    "",
    "## Scan summary",
    `- Commits analyzed: ${scan.commitsAnalyzed}`,
    `- Repeated path patterns: ${scan.repeatedPathPatterns.length}`,
    `- Generated at: ${new Date().toISOString()}`,
    ""
  ].join("\n");
}

function metadataTaskDescription(skill: SkillMetadata): string {
  if (skill.task_description) {
    return skill.task_description;
  }

  const name = skill.name.replace(/\.$/, "");
  return `Use this for ${name.charAt(0).toLowerCase()}${name.slice(1)} changes.`;
}

function refreshedMetadata(scan: ScanResult, metadata: SkillMetadata, evaluation: Evaluation, now: string): SkillMetadata {
  const validationCommands = stableUnique(scan.validationCommands);
  const patternSignature = {
    ...metadata.pattern_signature,
    validation_commands: validationCommands
  };
  patternSignature.hash = stableHash({
    generic_signals: patternSignature.generic_signals,
    common_directories: patternSignature.common_directories,
    repeated_file_terms: patternSignature.repeated_file_terms,
    dominant_domain_terms: patternSignature.dominant_domain_terms,
    validation_commands: patternSignature.validation_commands
  });

  return {
    ...metadata,
    generated_from_head: currentHead(scan),
    evidence_commits: mergeEvidence(metadata.evidence_commits, evaluation.supportingCommits),
    pattern_signature: patternSignature,
    validation_commands: validationCommands,
    status: metadata.status === "deprecated" ? "deprecated" : evaluation.status,
    last_refreshed_at: now,
    validation_warnings: evaluation.validationWarnings,
    drift_reasons: evaluation.driftReasons
  };
}

function buildLifecycleReport(scan: ScanResult, metadata: SkillMetadata[], options: LifecycleOptions): SkillLifecycleReport {
  const summaries = metadata.map((skill) => {
    const evaluation = evaluateSkill(scan, skill, options);
    return toSummary(skill, evaluation);
  });

  return {
    repoRoot: scan.repoRoot,
    generatedAt: new Date().toISOString(),
    currentHead: currentHead(scan),
    fresh: summaries.filter((summary) => summary.status === "fresh"),
    stale: summaries.filter((summary) => summary.status === "stale"),
    drifting: summaries.filter((summary) => summary.status === "drifting"),
    deprecated: summaries.filter((summary) => summary.status === "deprecated"),
    validationCommandChanges: summaries.filter((summary) => summary.validation_warnings.length > 0),
    suggestedHumanReview: summaries.filter((summary) => summary.suggested_human_review)
  };
}

function evaluateSkill(scan: ScanResult, metadata: SkillMetadata, options: LifecycleOptions): Evaluation {
  const newCommits = commitsSince(scan.commits, metadata.generated_from_head);
  const validationWarnings = validationCommandWarnings(metadata.validation_commands, scan.validationCommands);
  const supportingCommits = newCommits.filter((commit) => commitSupportsSkill(commit, metadata)).map(toEvidenceCommit);
  const driftReasons = [
    ...validationWarnings,
    ...detectDrift(metadata, newCommits)
  ];

  let status: SkillStatus = metadata.status;
  if (metadata.status === "deprecated") {
    status = "deprecated";
  } else if (driftReasons.length > 0) {
    status = "drifting";
  } else if (supportingCommits.length > 0) {
    status = "fresh";
  } else if (newCommits.length >= (options.staleCommitThreshold ?? DEFAULT_STALE_COMMIT_THRESHOLD)) {
    status = "stale";
  } else {
    status = metadata.status === "stale" || metadata.status === "drifting" ? metadata.status : "fresh";
  }

  return {
    status,
    supportingCommits,
    validationWarnings,
    driftReasons,
    newCommits
  };
}

function detectDrift(metadata: SkillMetadata, newCommits: CommitMetadata[]): string[] {
  if (newCommits.length === 0) {
    return [];
  }

  const broadMatches = newCommits.filter((commit) => broadAreas(commit.genericSignals).some((area) => broadAreas(metadata.generic_signals).includes(area)));
  if (broadMatches.length < 2) {
    return [];
  }

  const reasons: string[] = [];
  const newSignals = topValues(broadMatches.flatMap((commit) => commit.genericSignals), 8);
  if (newSignals.length > 0 && jaccard(newSignals, metadata.generic_signals) < 0.28) {
    reasons.push("New commits match the same broad area but use different dominant signals.");
  }

  const newDirectories = topValues(broadMatches.flatMap((commit) => commit.touchedDirectories), 6);
  if (newDirectories.length > 0 && jaccard(newDirectories, metadata.pattern_signature.common_directories) < 0.2) {
    reasons.push("Common files or directories shifted significantly.");
  }

  const newTerms = topValues(broadMatches.flatMap((commit) => [...commit.filenameTerms, ...commit.messageTerms]), 8);
  if (metadata.dominant_terms.length > 0 && newTerms.length > 0 && jaccard(newTerms, metadata.dominant_terms) < 0.2) {
    reasons.push("Dominant naming terms changed strongly.");
  }

  const oldTestDirs = metadata.pattern_signature.common_directories.filter((directory) => /(^|\/)(tests?|e2e|playwright|cypress)(\/|$)/i.test(directory));
  const newTestDirs = topValues(
    broadMatches
      .filter((commit) => commit.genericSignals.some((signal) => signal.includes("test")))
      .flatMap((commit) => commit.touchedDirectories.filter((directory) => /(^|\/)(tests?|e2e|playwright|cypress)(\/|$)/i.test(directory))),
    6
  );
  if (oldTestDirs.length > 0 && newTestDirs.length > 0 && jaccard(oldTestDirs, newTestDirs) < 0.2) {
    reasons.push("Tests moved to a different framework or folder.");
  }

  return reasons;
}

function commitSupportsSkill(commit: CommitMetadata, metadata: SkillMetadata): boolean {
  const signalScore = jaccard(commit.genericSignals, metadata.generic_signals);
  const directoryScore = jaccard(commit.touchedDirectories, metadata.pattern_signature.common_directories);
  const termScore = jaccard([...commit.filenameTerms, ...commit.messageTerms], metadata.dominant_terms);
  return signalScore >= 0.35 || directoryScore >= 0.25 || termScore >= 0.25;
}

function validationCommandWarnings(previous: string[], current: string[]): string[] {
  const oldCommands = stableUnique(previous);
  const newCommands = stableUnique(current);
  if (arraysEqual(oldCommands, newCommands)) {
    return [];
  }
  return [`Validation commands changed from ${oldCommands.join(", ") || "none"} to ${newCommands.join(", ") || "none"}.`];
}

function toSummary(metadata: SkillMetadata, evaluation: Evaluation): SkillValidationSummary {
  const status = metadata.status === "deprecated" ? "deprecated" : evaluation.status;
  const validationWarnings = stableUnique([...(evaluation.validationWarnings ?? []), ...(metadata.validation_warnings ?? [])]);
  const driftReasons = stableUnique([...(evaluation.driftReasons ?? []), ...(metadata.drift_reasons ?? [])]);
  return {
    skill_id: metadata.skill_id,
    name: metadata.name,
    status,
    human_approved: metadata.human_approved === true,
    supporting_commits: evaluation.supportingCommits,
    drift_reasons: driftReasons,
    validation_warnings: validationWarnings,
    suggested_human_review: status === "stale" || status === "drifting" || status === "deprecated"
  };
}

function requireSkillMetadata(repoRoot: string, skillId: string): SkillMetadata {
  const metadata = readSkillMetadata(repoRoot).find((skill) => skill.skill_id === skillId || slug(skill.name) === skillId);
  if (!metadata) {
    throw new Error(`Skill metadata not found: ${skillId}`);
  }
  return metadata;
}

function findDraftSkillMetadata(repoRoot: string, skillId: string): SkillMetadata | undefined {
  return readDraftSkillMetadata(repoRoot).find((skill) => skill.skill_id === skillId || slug(skill.name) === skillId);
}

function refreshSkillMarkdownBanner(skillDir: string, metadata: SkillMetadata): void {
  const skillPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillPath)) {
    return;
  }
  const markdown = readFileSync(skillPath, "utf8");
  writeFileSync(skillPath, applySkillBanner(markdown, metadata), "utf8");
}

function stripSkillBanner(markdown: string): string {
  if (!markdown.startsWith("Status: ")) {
    return markdown;
  }

  const marker = `\n${BANNER_END}\n`;
  const end = markdown.indexOf(marker);
  if (end === -1) {
    return markdown;
  }
  return markdown.slice(end + marker.length).replace(/^\n/, "");
}

function commitsSince(commits: CommitMetadata[], generatedFromHead: string): CommitMetadata[] {
  if (!generatedFromHead || generatedFromHead === "unknown") {
    return commits;
  }

  const index = commits.findIndex((commit) => commit.hash === generatedFromHead || commit.shortHash === generatedFromHead);
  if (index === -1) {
    return commits;
  }
  return commits.slice(0, index);
}

function mergeEvidence(existing: EvidenceCommit[], incoming: EvidenceCommit[]): EvidenceCommit[] {
  const seen = new Set<string>();
  const merged: EvidenceCommit[] = [];
  for (const commit of [...incoming, ...existing]) {
    if (seen.has(commit.hash)) {
      continue;
    }
    seen.add(commit.hash);
    merged.push(commit);
  }
  return merged.slice(0, 20);
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

function currentHead(scan: ScanResult): string {
  return scan.commits[0]?.hash ?? "unknown";
}

function broadAreas(signals: string[]): string[] {
  const areas = new Set<string>();
  for (const signal of signals) {
    if (/^(ui|component|page_or_screen|route_view|style|frontend)/.test(signal)) areas.add("frontend");
    if (/^(backend|api_route|controller|service_layer|repository_or_dao|middleware|auth|validation|serialization|background_job|queue_or_event)/.test(signal)) areas.add("backend");
    if (/^(db|migration|schema|model_or_entity|seed_data|query|index)/.test(signal)) areas.add("database");
    if (/^(config|env|package_or_dependency|ci|docker|terraform_or_infra|deployment)/.test(signal)) areas.add("config");
    if (/(test|fixture)/.test(signal)) areas.add("tests");
    if (/^(docs|readme|adr_or_design_doc|changelog)/.test(signal)) areas.add("docs");
    if (/^cli_command/.test(signal)) areas.add("cli");
  }
  return [...areas].sort();
}

function renderSummaryList(summaries: SkillValidationSummary[]): string[] {
  if (summaries.length === 0) {
    return ["- None"];
  }
  return summaries.map((summary) => {
    const reasons = [...summary.drift_reasons, ...summary.validation_warnings].filter(Boolean);
    const suffix = reasons.length > 0 ? `; ${reasons.join(" ")}` : "";
    return `- ${summary.name} (${summary.skill_id})${suffix}`;
  });
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

function jaccard(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]).size;
  if (union === 0) {
    return 0;
  }
  const intersection = [...a].filter((value) => b.has(value)).length;
  return intersection / union;
}

function stableUnique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function safeTimestamp(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
