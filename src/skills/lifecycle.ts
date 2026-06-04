import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CandidateSkill,
  CommitMetadata,
  DraftSkillReviewSummary,
  EvidenceCommit,
  ScanResult,
  SkillLifecycleReport,
  SkillMetadata,
  SkillPatternSignature,
  SkillReviewReport,
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
  const status = metadata.human_approved ? "human-approved" : metadata.status;
  const lines = [
    `Status: ${status}`,
    `Generated from HEAD: ${metadata.generated_from_head}`,
    `Last refreshed: ${metadata.last_refreshed_at}`,
    `Evidence commits: ${metadata.evidence_commits.length}`
  ];

  if (metadata.human_approved) {
    if (metadata.approved_at) lines.push(`Approved at: ${metadata.approved_at}`);
    if (metadata.approved_by) lines.push(`Approved by: ${metadata.approved_by}`);
    lines.push("Human approved: true");
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

  if (metadata.status === "rejected") {
    lines.push("Warning: This draft skill was rejected. Do not use it as agent guidance.");
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

export function approveSkill(repoRoot: string, skillId: string, now = new Date().toISOString(), approvedBy = reviewerName()): SkillMetadata {
  const draft = findDraftSkillMetadata(repoRoot, skillId);
  if (draft) {
    return approveDraftSkill(repoRoot, draft, now, approvedBy);
  }

  const metadata = requireSkillMetadata(repoRoot, skillId);
  const updated: SkillMetadata = {
    ...metadata,
    human_approved: true,
    approved_at: now,
    approved_by: approvedBy,
    status: "fresh",
    promotion_level: "agent_ready",
    last_refreshed_at: now
  };
  const skillDir = join(repoRoot, ".compactor", "skills", metadata.skill_id);
  writeSkillMetadata(skillDir, updated, true);
  refreshSkillMarkdownBanner(skillDir, updated);
  regenerateCompactorAgents(repoRoot);
  return updated;
}

function approveDraftSkill(repoRoot: string, metadata: SkillMetadata, now: string, approvedBy: string): SkillMetadata {
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
    approved_by: approvedBy,
    status: "fresh",
    promotion_level: "agent_ready",
    last_refreshed_at: now
  };
  writeSkillMetadata(skillDir, updated, true);
  refreshSkillMarkdownBanner(skillDir, updated);
  regenerateCompactorAgents(repoRoot);
  return updated;
}

export function rejectDraftSkill(repoRoot: string, skillId: string, now = new Date().toISOString(), rejectedBy = reviewerName()): SkillMetadata {
  const metadata = requireDraftSkillMetadata(repoRoot, skillId);
  const draftDir = join(repoRoot, ".compactor", "draft-skills", metadata.skill_id);
  const archiveDir = join(repoRoot, ".compactor", "archive", "rejected-skills");
  const rejectedDir = uniqueDirectoryPath(archiveDir, metadata.skill_id);
  const updated: SkillMetadata = {
    ...metadata,
    status: "rejected",
    rejected_at: now,
    rejected_by: rejectedBy,
    last_refreshed_at: now,
    human_approved: false
  };

  mkdirSync(archiveDir, { recursive: true });
  renameSync(draftDir, rejectedDir);
  writeSkillMetadata(rejectedDir, updated, true);
  refreshSkillMarkdownBanner(rejectedDir, updated);
  removeEmptyDirectory(join(repoRoot, ".compactor", "draft-skills"));
  regenerateCompactorAgents(repoRoot);
  return updated;
}

export function deprecateSkill(repoRoot: string, skillId: string, now = new Date().toISOString(), deprecatedBy = reviewerName()): SkillMetadata {
  const metadata = requireSkillMetadata(repoRoot, skillId);
  const updated: SkillMetadata = {
    ...metadata,
    status: "deprecated",
    deprecated_at: now,
    deprecated_by: deprecatedBy,
    last_refreshed_at: now,
    drift_reasons: stableUnique([...(metadata.drift_reasons ?? []), "Skill was manually deprecated."])
  };
  const skillDir = join(repoRoot, ".compactor", "skills", metadata.skill_id);
  const archiveDir = join(repoRoot, ".compactor", "archive", "deprecated-skills");
  const deprecatedDir = uniqueDirectoryPath(archiveDir, metadata.skill_id);

  mkdirSync(archiveDir, { recursive: true });
  renameSync(skillDir, deprecatedDir);
  writeSkillMetadata(deprecatedDir, updated, true);
  refreshSkillMarkdownBanner(deprecatedDir, updated);
  removeEmptyDirectory(join(repoRoot, ".compactor", "skills"));
  regenerateCompactorAgents(repoRoot);
  return updated;
}

export function promotePatternToDraft(repoRoot: string, patternId: string, name: string, now = new Date().toISOString()): SkillMetadata {
  const patternDir = requirePatternDirectory(repoRoot, patternId);
  const patternMarkdownPath = join(patternDir, "PATTERN.md");
  const patternMarkdown = readFileSync(patternMarkdownPath, "utf8");
  const skillId = uniqueDraftSkillId(repoRoot, slug(name));
  const draftDir = join(repoRoot, ".compactor", "draft-skills", skillId);
  const archiveDir = join(repoRoot, ".compactor", "archive", "promoted-patterns");
  const archivedPatternDir = uniqueDirectoryPath(archiveDir, patternId);
  const metadata: SkillMetadata = {
    skill_id: skillId,
    name,
    created_at: now,
    generated_from_head: "unknown",
    evidence_commits: [],
    pattern_signature: emptyPatternSignature(),
    generic_signals: [],
    dominant_terms: [],
    validation_commands: [],
    pattern_confidence: 0,
    naming_confidence: 1,
    promotion_level: "draft",
    workflow_quality: 0,
    status: "draft",
    last_refreshed_at: now,
    managed_by: "compactor",
    human_approved: false,
    promoted_from_pattern: patternId,
    human_named: true,
    proposed_name: name,
    validation_warnings: [],
    drift_reasons: []
  };

  mkdirSync(draftDir, { recursive: true });
  writeFileSync(join(draftDir, "SKILL.md"), renderPromotedPatternDraftMarkdown(metadata, patternMarkdown), "utf8");
  writeSkillMetadata(draftDir, metadata);
  mkdirSync(archiveDir, { recursive: true });
  renameSync(patternDir, archivedPatternDir);
  removeEmptyDirectory(join(repoRoot, ".compactor", "patterns"));
  regenerateCompactorAgents(repoRoot);
  return metadata;
}

export function renameDraftSkill(repoRoot: string, skillId: string, name: string, now = new Date().toISOString(), renamedBy = reviewerName()): SkillMetadata {
  const metadata = requireDraftSkillMetadata(repoRoot, skillId);
  const oldDir = join(repoRoot, ".compactor", "draft-skills", metadata.skill_id);
  const nextSkillId = slug(name);
  const nextDir = join(repoRoot, ".compactor", "draft-skills", nextSkillId);
  if (nextSkillId !== metadata.skill_id && existsSync(nextDir)) {
    throw new Error(`Cannot rename draft because a draft already exists with id: ${nextSkillId}`);
  }

  if (nextSkillId !== metadata.skill_id) {
    renameSync(oldDir, nextDir);
  }

  const updated: SkillMetadata = {
    ...metadata,
    skill_id: nextSkillId,
    name,
    proposed_name: name,
    human_edited: true,
    renamed_at: now,
    renamed_by: renamedBy,
    last_refreshed_at: now
  };
  writeSkillMetadata(nextDir, updated, true);
  renameDraftMarkdownTitle(join(nextDir, "SKILL.md"), updated);
  regenerateCompactorAgents(repoRoot);
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

export function reviewSkills(repoRoot: string): SkillReviewReport {
  const active = readSkillMetadata(repoRoot).filter((skill) => skill.status !== "deprecated" && skill.status !== "rejected");
  const drafts = readDraftSkillMetadata(repoRoot).filter((skill) => skill.status === "draft" || skill.promotion_level === "draft");
  return {
    repoRoot,
    agentReadySkills: active.filter((skill) => skill.human_approved === true || skill.status === "fresh" || skill.promotion_level === "agent_ready"),
    draftSkills: drafts.map((skill) => draftReviewSummary(repoRoot, skill)),
    patternCandidates: readPatternCandidateRefs(repoRoot),
    archivedOrDeprecatedSkills: readArchivedSkillRefs(repoRoot)
  };
}

export function renderSkillReviewDashboard(report: SkillReviewReport): string {
  return [
    "Compactor Review Dashboard",
    "",
    `Repository: ${report.repoRoot}`,
    "",
    `Agent-ready skills: ${report.agentReadySkills.length}`,
    ...renderReviewSkillList(report.agentReadySkills),
    "",
    `Draft skills needing review: ${report.draftSkills.length}`,
    ...renderDraftReviewList(report.draftSkills),
    "",
    `Pattern candidates: ${report.patternCandidates.length}`,
    ...renderPatternReviewList(report.patternCandidates),
    "",
    `Archived/deprecated skills: ${report.archivedOrDeprecatedSkills.length}`,
    ...renderArchivedReviewList(report.archivedOrDeprecatedSkills),
    ""
  ].join("\n");
}

export function regenerateCompactorAgents(repoRoot: string): string {
  const agentsPath = join(repoRoot, ".compactor", "AGENTS.md");
  mkdirSync(join(repoRoot, ".compactor"), { recursive: true });
  const markdown = renderAgentsMarkdownFromMetadata(minimalScan(repoRoot), [...readSkillMetadata(repoRoot), ...readDraftSkillMetadata(repoRoot)], readPatternCandidateAgentRefs(repoRoot));
  writeFileSync(agentsPath, markdown, "utf8");
  return agentsPath;
}

export function renderAgentsMarkdownFromMetadata(scan: ScanResult, metadata: SkillMetadata[], patternCandidates: Array<Pick<CandidateSkill, "id" | "name">> = []): string {
  const active = metadata.filter((skill) => skill.status !== "deprecated" && skill.status !== "rejected" && skill.status !== "draft" && (skill.human_approved || (skill.status === "fresh" && skill.promotion_level === "agent_ready")));
  const drafts = metadata.filter((skill) => skill.status !== "deprecated" && skill.status !== "rejected" && (skill.status === "draft" || skill.promotion_level === "draft") && !skill.human_approved);
  const needsReview = metadata.filter((skill) => skill.status !== "deprecated" && skill.status !== "rejected" && skill.status !== "draft" && (skill.status === "stale" || skill.status === "drifting") && !skill.human_approved);

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

function draftReviewSummary(repoRoot: string, skill: SkillMetadata): DraftSkillReviewSummary {
  const skillPath = join(repoRoot, ".compactor", "draft-skills", skill.skill_id, "SKILL.md");
  const markdown = readFileIfExists(skillPath);
  return {
    skill_id: skill.skill_id,
    name: skill.name,
    confidence: Math.max(skill.pattern_confidence, skill.naming_confidence),
    learned_surface: extractLearnedSurface(markdown, skill),
    representative_files: extractRepresentativeFiles(markdown),
    validation_commands: skill.validation_commands,
    skill_path: skillPath
  };
}

function extractLearnedSurface(markdown: string, skill: SkillMetadata): string {
  const match = /^- Surface:\s+(.+)$/m.exec(markdown);
  if (match?.[1]) {
    return match[1].trim();
  }
  return skill.pattern_signature.common_directories[0] ?? "unknown";
}

function extractRepresentativeFiles(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const result: string[] = [];
  let inBlock = false;

  for (const line of lines) {
    if (/^- Representative source files:/.test(line) || /^## Relevant examples/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock && /^## /.test(line)) {
      break;
    }
    if (inBlock) {
      const match = /^\s*-\s+(.+)$/.exec(line);
      if (match?.[1]) {
        result.push(match[1].trim());
      } else if (line.trim() && !/^- Co-changing tests:/.test(line)) {
        break;
      }
    }
  }

  return stableUnique(result).slice(0, 5);
}

function readPatternCandidateRefs(repoRoot: string): SkillReviewReport["patternCandidates"] {
  const patternsDir = join(repoRoot, ".compactor", "patterns");
  return readdirSafe(patternsDir).map((entry) => {
    const path = join(patternsDir, entry, "PATTERN.md");
    return {
      pattern_id: entry,
      name: readPatternName(path, entry),
      path
    };
  });
}

function readPatternCandidateAgentRefs(repoRoot: string): Array<Pick<CandidateSkill, "id" | "name">> {
  return readPatternCandidateRefs(repoRoot).map((pattern) => ({
    id: pattern.pattern_id,
    name: pattern.name
  }));
}

function readPatternName(path: string, fallback: string): string {
  const markdown = readFileIfExists(path);
  const match = /^#\s+(?:Pattern Candidate:\s*)?(.+)$/m.exec(markdown);
  return match?.[1]?.trim() || fallback;
}

function readArchivedSkillRefs(repoRoot: string): SkillReviewReport["archivedOrDeprecatedSkills"] {
  const archiveRoot = join(repoRoot, ".compactor", "archive");
  const archiveDirs = ["skills", "deprecated-skills", "rejected-skills", "promoted-patterns"];
  const archived = archiveDirs.flatMap((directory) => {
    const fullPath = join(archiveRoot, directory);
    return readdirSafe(fullPath).flatMap((entry) => {
      const path = join(fullPath, entry);
      const metadata = readMetadataSafe(join(path, "metadata.json"));
      if (!metadata) {
        return [];
      }
      return [{
        skill_id: metadata.skill_id,
        name: metadata.name,
        status: metadata.status,
        path
      }];
    });
  });

  const deprecatedInSkills = readSkillMetadata(repoRoot)
    .filter((skill) => skill.status === "deprecated")
    .map((skill) => ({
      skill_id: skill.skill_id,
      name: skill.name,
      status: skill.status,
      path: join(repoRoot, ".compactor", "skills", skill.skill_id)
    }));

  return [...archived, ...deprecatedInSkills].sort((a, b) => a.name.localeCompare(b.name));
}

function renderReviewSkillList(skills: SkillMetadata[]): string[] {
  if (skills.length === 0) {
    return ["- None"];
  }
  return skills.map((skill) => `- ${skill.skill_id}: ${skill.name} (${Math.round(skill.pattern_confidence * 100)}% pattern, ${Math.round(skill.naming_confidence * 100)}% naming)`);
}

function renderDraftReviewList(drafts: DraftSkillReviewSummary[]): string[] {
  if (drafts.length === 0) {
    return ["- None"];
  }

  return drafts.flatMap((draft) => [
    `- ${draft.skill_id}: ${draft.name}`,
    `  confidence: ${Math.round(draft.confidence * 100)}%`,
    `  learned surface: ${draft.learned_surface}`,
    `  representative files: ${draft.representative_files.join(", ") || "none"}`,
    `  validation commands: ${draft.validation_commands.join(", ") || "none"}`,
    `  path: ${draft.skill_path}`
  ]);
}

function renderPatternReviewList(patterns: SkillReviewReport["patternCandidates"]): string[] {
  if (patterns.length === 0) {
    return ["- None"];
  }
  return patterns.map((pattern) => `- ${pattern.pattern_id}: ${pattern.name} (${pattern.path})`);
}

function renderArchivedReviewList(archived: SkillReviewReport["archivedOrDeprecatedSkills"]): string[] {
  if (archived.length === 0) {
    return ["- None"];
  }
  return archived.map((skill) => `- ${skill.skill_id}: ${skill.name} (${skill.status}) ${skill.path}`);
}

function minimalScan(repoRoot: string): ScanResult {
  return {
    repoRoot,
    packageScripts: [],
    validationCommands: [],
    generatedAt: new Date().toISOString(),
    commitsAnalyzed: 0,
    commits: [],
    repeatedPathPatterns: []
  };
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
    status: metadata.status === "deprecated" || metadata.status === "rejected" ? metadata.status : evaluation.status,
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
  if (metadata.status === "deprecated" || metadata.status === "rejected") {
    status = metadata.status;
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
  const status = metadata.status === "deprecated" || metadata.status === "rejected" ? metadata.status : evaluation.status;
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
    suggested_human_review: status === "stale" || status === "drifting" || status === "deprecated" || status === "rejected"
  };
}

function requireSkillMetadata(repoRoot: string, skillId: string): SkillMetadata {
  const metadata = readSkillMetadata(repoRoot).find((skill) => skill.skill_id === skillId || slug(skill.name) === skillId);
  if (!metadata) {
    throw new Error(`Skill metadata not found: ${skillId}`);
  }
  return metadata;
}

function requireDraftSkillMetadata(repoRoot: string, skillId: string): SkillMetadata {
  const metadata = findDraftSkillMetadata(repoRoot, skillId);
  if (!metadata) {
    throw new Error(`Draft skill metadata not found: ${skillId}`);
  }
  return metadata;
}

function findDraftSkillMetadata(repoRoot: string, skillId: string): SkillMetadata | undefined {
  return readDraftSkillMetadata(repoRoot).find((skill) => skill.skill_id === skillId || slug(skill.name) === skillId);
}

function requirePatternDirectory(repoRoot: string, patternId: string): string {
  const patternsDir = join(repoRoot, ".compactor", "patterns");
  const match = readdirSafe(patternsDir).find((entry) => entry === patternId || slug(entry) === patternId);
  if (!match) {
    throw new Error(`Pattern candidate not found: ${patternId}`);
  }
  return join(patternsDir, match);
}

function refreshSkillMarkdownBanner(skillDir: string, metadata: SkillMetadata): void {
  const skillPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillPath)) {
    return;
  }
  const markdown = readFileSync(skillPath, "utf8");
  writeFileSync(skillPath, applySkillBanner(markdown, metadata), "utf8");
}

function renameDraftMarkdownTitle(skillPath: string, metadata: SkillMetadata): void {
  const markdown = readFileIfExists(skillPath);
  const body = stripSkillBanner(markdown);
  const renamed = /^#\s+/m.test(body)
    ? body.replace(/^#\s+.+$/m, `# ${metadata.name}`)
    : `# ${metadata.name}\n\n${body}`;
  writeFileSync(skillPath, `${renderSkillBanner(metadata)}${renamed.replace(/^\n/, "")}`, "utf8");
}

function renderPromotedPatternDraftMarkdown(metadata: SkillMetadata, patternMarkdown: string): string {
  return [
    renderSkillBanner(metadata).trimEnd(),
    "",
    `# ${metadata.name}`,
    "",
    "This draft skill was promoted from a Compactor pattern candidate by a human-provided name. Review and edit the workflow before approving it as trusted agent guidance.",
    "",
    "## When to use",
    "Use this when the original pattern candidate evidence matches the task. Review the source pattern before relying on this draft.",
    "",
    "## Workflow",
    "1. Read the promoted pattern evidence below.",
    "2. Find the closest current implementation examples in the repository.",
    "3. Draft concrete source, test, and validation steps before approving this skill.",
    "4. Run relevant validation commands from the current repo.",
    "",
    "## Validation",
    "- No confident validation command discovered.",
    "",
    "## Promoted pattern",
    patternMarkdown.trim(),
    ""
  ].join("\n");
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

function readdirSafe(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function readFileIfExists(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function readMetadataSafe(path: string): SkillMetadata | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SkillMetadata;
  } catch {
    return undefined;
  }
}

function uniqueDirectoryPath(parent: string, directoryName: string): string {
  const base = join(parent, directoryName);
  if (!existsSync(base)) {
    return base;
  }

  let suffix = 2;
  let candidate = join(parent, `${directoryName}-${suffix}`);
  while (existsSync(candidate)) {
    suffix += 1;
    candidate = join(parent, `${directoryName}-${suffix}`);
  }
  return candidate;
}

function uniqueDraftSkillId(repoRoot: string, baseId: string): string {
  const safeBase = baseId || "draft-skill";
  let candidate = safeBase;
  let suffix = 2;
  while (
    existsSync(join(repoRoot, ".compactor", "draft-skills", candidate)) ||
    existsSync(join(repoRoot, ".compactor", "skills", candidate))
  ) {
    candidate = `${safeBase}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function removeEmptyDirectory(path: string): void {
  try {
    if (readdirSync(path).length === 0) {
      rmSync(path, { recursive: true, force: true });
    }
  } catch {
    // Directory does not exist or cannot be read; nothing to clean up.
  }
}

function reviewerName(): string {
  return process.env.USER || process.env.GIT_AUTHOR_NAME || "unknown";
}

function emptyPatternSignature(): SkillPatternSignature {
  const signature = {
    generic_signals: [] as string[],
    common_directories: [] as string[],
    repeated_file_terms: [] as string[],
    dominant_domain_terms: [] as string[],
    validation_commands: [] as string[]
  };
  return {
    hash: stableHash(signature),
    ...signature
  };
}

function safeTimestamp(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
