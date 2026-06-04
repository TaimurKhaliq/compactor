import type { CandidateSkill, MiningResult } from "../types.js";

export function generateSkillExplanation(skillId: string, mining: MiningResult): string {
  const skill = mining.candidates.find((candidate) => candidate.id === skillId || slug(candidate.name) === skillId);

  if (!skill) {
    const available = mining.candidates.map((candidate) => candidate.id).join(", ") || "none";
    return [`Skill not found: ${skillId}`, "", `Available skills: ${available}`, ""].join("\n");
  }

  return renderSkillExplanation(skill);
}

function renderSkillExplanation(skill: CandidateSkill): string {
  return [
    `Compactor Explain: ${skill.name}`,
    "",
    `Skill id: ${skill.id}`,
    `Confidence: ${Math.round(skill.confidence * 100)}%`,
    `Rationale: ${skill.rationale}`,
    "",
    "Confidence factors:",
    ...renderList(skill.confidenceFactors),
    "",
    "Path signals:",
    ...renderList(skill.pathSignals),
    "",
    "Diff signals:",
    ...renderList(skill.diffSignals),
    "",
    "Possible false positives:",
    ...renderList(skill.falsePositiveNotes),
    "",
    "Evidence commits:",
    ...skill.evidenceCommits.map(renderEvidenceCommit),
    ""
  ].join("\n");
}

function renderEvidenceCommit(commit: CandidateSkill["evidenceCommits"][number]): string {
  const signals = commit.diffSignals.length > 0 ? `; signals: ${commit.diffSignals.slice(0, 3).join(", ")}` : "";
  return `- ${commit.shortHash}: ${commit.message}${signals}`;
}

function renderList(items: string[]): string[] {
  if (items.length === 0) {
    return ["- None"];
  }

  return items.map((item) => `- ${item}`);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
