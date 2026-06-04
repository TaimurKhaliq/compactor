import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CandidateSkill, GenerationResult, MiningResult, ScanResult } from "../types.js";

export function generateSkillDrafts(scan: ScanResult, mining: MiningResult): GenerationResult {
  const compactorDir = join(scan.repoRoot, ".compactor");
  const skillsDir = join(compactorDir, "skills");
  mkdirSync(skillsDir, { recursive: true });

  const skillFiles = mining.candidates.map((candidate) => {
    const skillDir = join(skillsDir, candidate.id);
    mkdirSync(skillDir, { recursive: true });
    const skillPath = join(skillDir, "SKILL.md");
    writeFileSync(skillPath, renderSkillMarkdown(candidate), "utf8");
    return {
      skillId: candidate.id,
      path: skillPath
    };
  });

  const agentsPath = join(compactorDir, "AGENTS.md");
  writeFileSync(agentsPath, renderAgentsMarkdown(scan, mining), "utf8");

  return {
    repoRoot: scan.repoRoot,
    generatedAt: new Date().toISOString(),
    agentsPath,
    skillFiles
  };
}

export function renderSkillMarkdown(candidate: CandidateSkill): string {
  return [
    `# ${candidate.name}`,
    "",
    `Proposed skill name: ${candidate.name}`,
    `Pattern confidence: ${formatConfidence(candidate.patternConfidence)}`,
    `Naming confidence: ${formatConfidence(candidate.namingConfidence)}`,
    "",
    "## When to use",
    renderWhenToUse(candidate),
    "",
    "## Why Compactor proposed this",
    candidate.rationale,
    ...candidate.confidenceFactors.map((factor) => `- ${factor}`),
    "",
    "## Generic signals detected",
    ...renderList(candidate.genericSignals),
    "",
    "## Common files/directories",
    ...renderCommonFiles(candidate),
    "",
    "## Repeated terms",
    ...renderList(candidate.repeatedTerms),
    "",
    "## Nearest examples",
    ...renderList(candidate.commonFiles.slice(0, 5)),
    "",
    "## Observed changes from diffs",
    ...renderList(candidate.observedChanges),
    "",
    "## Validation",
    ...renderValidation(candidate),
    "",
    "## Evidence",
    ...candidate.evidenceCommits.slice(0, 5).map(renderEvidenceCommit),
    "",
    "## Possible false positives / needs human review",
    ...renderList(candidate.falsePositiveNotes),
    ""
  ].join("\n");
}

export function renderAgentsMarkdown(scan: ScanResult, mining: MiningResult): string {
  const candidateLines =
    mining.candidates.length === 0
      ? ["- No repeated skill candidates were found in the scanned commit range yet."]
      : mining.candidates.map(
          (candidate) =>
            `- ${candidate.name}: use .compactor/skills/${candidate.id}/SKILL.md when work matches ${candidate.genericSignals
              .slice(0, 4)
              .join(", ") || "the observed commit evidence"}.`
        );

  return [
    "# Compactor Draft Repo Guidance",
    "",
    "This draft was generated from local git history. Review it before copying guidance into a production AGENTS.md.",
    "",
    "## Repository guidance",
    "- Start from the nearest existing implementation before introducing a new pattern.",
    "- Match work to generated skills by generic signals, common directories, and representative evidence commits.",
    "- Run only validation commands that exist in this repository.",
    "",
    "## Candidate skills",
    ...candidateLines,
    "",
    "## Scan summary",
    `- Commits analyzed: ${scan.commitsAnalyzed}`,
    `- Repeated path patterns: ${scan.repeatedPathPatterns.length}`,
    `- Generated at: ${new Date().toISOString()}`,
    ""
  ].join("\n");
}

function renderWhenToUse(candidate: CandidateSkill): string {
  const signals = candidate.genericSignals.slice(0, 5).join(", ") || "the repeated evidence pattern";
  const directories = candidate.commonDirectories.slice(0, 3).join(", ") || "the common directories shown below";
  return `Use this when a change resembles commits with ${signals}, especially around ${directories}.`;
}

function renderCommonFiles(candidate: CandidateSkill): string[] {
  const lines: string[] = [];
  lines.push("- Common files:");
  lines.push(...renderList(candidate.commonFiles.slice(0, 8)));
  lines.push("- Common directories:");
  lines.push(...renderList(candidate.commonDirectories.slice(0, 6)));
  return lines;
}

function renderValidation(candidate: CandidateSkill): string[] {
  if (candidate.suggestedValidationCommands.length === 0) {
    return ["- No confident validation command discovered."];
  }

  return candidate.suggestedValidationCommands.map((command) => `- ${command}`);
}

function renderEvidenceCommit(commit: CandidateSkill["evidenceCommits"][number]): string {
  const label = commit.url ? `[${commit.shortHash}](${commit.url})` : `\`${commit.shortHash}\``;
  const signals = commit.diffSignals.length > 0 ? ` (${commit.diffSignals.slice(0, 2).join("; ")})` : "";
  return `- ${label}: ${commit.message}${signals}`;
}

function renderList(items: string[]): string[] {
  if (items.length === 0) {
    return ["- None"];
  }

  return items.map((item) => `- ${item}`);
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}
