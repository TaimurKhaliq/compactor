import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CandidateSkill, MiningResult, ScanResult } from "../types.js";

interface ReportOptions {
  archivedSkillCount?: number;
}

export function generateReport(scan: ScanResult, mining: MiningResult, options: ReportOptions = {}): string {
  const repeatedOccurrences = mining.candidates.reduce(
    (sum, candidate) => sum + Math.max(0, candidate.evidenceCommits.length - 1),
    0
  );
  const estimatedTokens = repeatedOccurrences * 1200;
  const archivedSkillCount = options.archivedSkillCount ?? countArchivedOrDeprecatedSkills(scan.repoRoot);

  return [
    "Compactor Report",
    "",
    `Commits analyzed: ${scan.commitsAnalyzed}`,
    `Agent-ready skills: ${mining.candidates.filter((candidate) => candidate.promotion_level === "agent_ready").length}`,
    `Draft skills: ${mining.candidates.filter((candidate) => candidate.promotion_level === "draft").length}`,
    `Pattern candidates: ${mining.candidates.filter((candidate) => candidate.promotion_level === "pattern_candidate").length}`,
    `Pattern families discovered: ${scan.patternFamilies?.length ?? 0}`,
    `Archived/deprecated skills: ${archivedSkillCount}`,
    `Merged duplicate drafts: ${mining.duplicateHandling?.mergedDuplicateDrafts ?? 0}`,
    `Suppressed duplicate drafts: ${mining.duplicateHandling?.suppressedDuplicateDrafts ?? 0}`,
    `Estimated token-saving rationale: ${renderTokenRationale(repeatedOccurrences, estimatedTokens)}`,
    "",
    "Top repeated patterns:",
    ...renderTopPatterns(scan),
    "",
    "Top pattern families:",
    ...renderTopPatternFamilies(scan),
    "",
    "Candidates:",
    ...renderCandidateSkills(mining.candidates),
    ""
  ].join("\n");
}

function renderTopPatternFamilies(scan: ScanResult): string[] {
  const families = scan.patternFamilies ?? [];
  if (families.length === 0) {
    return ["- No implementation fingerprint families discovered."];
  }

  return families.slice(0, 8).map((family) => {
    const frameworks = family.frameworks.length > 0 ? `; frameworks: ${family.frameworks.join(", ")}` : "";
    const libraries = family.libraries.length > 0 ? `; libraries: ${family.libraries.join(", ")}` : "";
    return `- ${family.name}: ${family.fileCount} files, ${Math.round(family.confidence * 100)}% confidence${frameworks}${libraries}`;
  });
}

function renderTokenRationale(repeatedOccurrences: number, estimatedTokens: number): string {
  if (repeatedOccurrences === 0) {
    return "No repeated candidates yet; scan more history after several feature commits.";
  }

  return `${repeatedOccurrences} repeated occurrences could avoid roughly ${estimatedTokens.toLocaleString()} rediscovery tokens by moving conventions into reusable skills.`;
}

function renderTopPatterns(scan: ScanResult): string[] {
  if (scan.repeatedPathPatterns.length === 0) {
    return ["- No repeated path patterns found in the scanned commit range."];
  }

  return scan.repeatedPathPatterns.slice(0, 8).map((pattern) => `- ${pattern.pattern}: ${pattern.count} commits`);
}

function renderCandidateSkills(candidates: CandidateSkill[]): string[] {
  if (candidates.length === 0) {
    return ["- No candidate skills found. Try increasing --limit or scan after more commits land."];
  }

  return candidates.map((candidate) => {
    const directories = candidate.commonDirectories.slice(0, 2).join(", ") || "mixed directories";
    const evidenceSummary = renderEvidenceSummary(candidate);
    return `- ${candidate.name} [${candidate.promotion_level}] (pattern ${Math.round(candidate.patternConfidence * 100)}%, naming ${Math.round(candidate.namingConfidence * 100)}%, workflow ${Math.round(candidate.workflowQuality * 100)}%): ${evidenceSummary}; common area: ${directories}`;
  });
}

function renderEvidenceSummary(candidate: CandidateSkill): string {
  const raw = candidate.rawEvidenceCommitCount ?? candidate.evidenceCommits.length;
  const relevant = candidate.surfaceRelevantCommitCount ?? candidate.evidenceCommits.length;
  const rejected = candidate.rejectedEvidenceCommitCount ?? 0;

  if (raw !== relevant || rejected > 0) {
    return `${relevant} surface-relevant commits used; ${rejected} rejected as generated/progress noise from ${raw} raw cluster commits`;
  }

  return `${candidate.evidenceCommits.length} commits`;
}

function countArchivedOrDeprecatedSkills(repoRoot: string): number {
  const archived = countDirectories(join(repoRoot, ".compactor", "archive", "skills"));
  const deprecated = readdirSafe(join(repoRoot, ".compactor", "skills")).filter((entry) => {
    try {
      const metadata = JSON.parse(readFileSync(join(repoRoot, ".compactor", "skills", entry, "metadata.json"), "utf8")) as {
        status?: string;
      };
      return metadata.status === "deprecated";
    } catch {
      return false;
    }
  }).length;
  return archived + deprecated;
}

function countDirectories(path: string): number {
  return readdirSafe(path).length;
}

function readdirSafe(path: string): string[] {
  if (!existsSync(path)) {
    return [];
  }

  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => entry.name !== "__MACOSX")
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
