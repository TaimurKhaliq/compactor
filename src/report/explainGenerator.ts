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
    `Output type: ${skill.outputType}`,
    `Task description: ${skill.taskDescription ?? "No task description recorded."}`,
    `Primary area: ${skill.primaryArea} (${Math.round(skill.primaryAreaShare * 100)}% of evidence commits)`,
    `Pattern confidence: ${Math.round(skill.patternConfidence * 100)}%`,
    `Naming confidence: ${Math.round(skill.namingConfidence * 100)}%`,
    `Rationale: ${skill.rationale}`,
    "",
    "Learned surface:",
    ...renderLearnedSurface(skill),
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
    "Naming evidence:",
    `- Generic category selected: ${skill.genericCategory}`,
    `- Generic category fallback: ${skill.genericFallbackName}`,
    `- Domain terms used for name: ${skill.domainTerms.length > 0 ? skill.domainTerms.join(", ") : "None"}`,
    `- Rejected noisy terms: ${skill.rejectedNoisyTerms.length > 0 ? skill.rejectedNoisyTerms.join(", ") : "None"}`,
    ...skill.namingReasons.map((reason) => `- ${reason}`),
    "",
    "Terms used for naming:",
    ...renderList(skill.repeatedTerms),
    "",
    "Category rationale:",
    ...renderList(categoryRationale(skill)),
    "",
    "Possible false positives:",
    ...renderList(skill.falsePositiveNotes),
    "",
    "Promotion decision:",
    ...renderList(skill.promotionReasons),
    "",
    "Evidence commits:",
    ...skill.evidenceCommits.map(renderEvidenceCommit),
    ""
  ].join("\n");
}

function renderEvidenceCommit(commit: CandidateSkill["evidenceCommits"][number]): string {
  const diffSignals = commit.diffSignals.length > 0 ? `; diff: ${commit.diffSignals.slice(0, 3).join(", ")}` : "";
  const pathSignals = commit.pathSignals.length > 0 ? `; path: ${commit.pathSignals.slice(0, 3).join(", ")}` : "";
  return `- ${commit.shortHash}: ${commit.message}${diffSignals}${pathSignals}`;
}

function renderLearnedSurface(skill: CandidateSkill): string[] {
  const surface = skill.learnedSurface;
  if (!surface) {
    return ["- None. This candidate was not strongly mapped to a learned implementation surface."];
  }

  return [
    `- Surface: ${surface.displayName}`,
    `- Directory: ${surface.commonDirectory}`,
    `- Task kind: ${surface.taskKind ?? "unknown"}`,
    `- Surface confidence: ${Math.round(surface.confidence * 100)}%`,
    `- Evidence commit match share: ${Math.round(surface.matchShare * 100)}%`,
    `- Representative source files: ${surface.representativeFiles.slice(0, 5).join(", ") || "None"}`,
    `- Co-changing tests: ${surface.coChangingTestFiles.slice(0, 5).join(", ") || "None"}`,
    `- Co-changing config/docs: ${surface.coChangingConfigOrDocsFiles.slice(0, 5).join(", ") || "None"}`,
    `- Validation commands: ${surface.validationCommands.join(", ") || "None"}`,
    `- Source-only terms: ${(surface.sourceTerms ?? []).join(", ") || "None"}`,
    `- Role counts: ${Object.entries(surface.roleCounts).map(([role, count]) => `${role}=${count}`).join(", ")}`,
    ...surface.coChangeEvidence.slice(0, 5).map((edge) => `- Co-change ${edge.weight} commits: ${edge.files.join(" + ")}`),
    ...surface.reasons.map((reason) => `- ${reason}`)
  ];
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

function categoryRationale(skill: CandidateSkill): string[] {
  const signals = new Set(skill.genericSignals);
  return [
    signals.has("backend_changed") || signals.has("api_route_changed") || signals.has("service_layer_changed")
      ? "Backend-related because backend, route, controller, service, middleware, or handler signals were present."
      : "Not strongly backend-related: no dominant backend route/controller/service signal.",
    signals.has("db_changed") || signals.has("migration_changed") || signals.has("schema_changed")
      ? "Database-related because migration, schema, model/entity, query, or index signals were present."
      : "Not strongly database-related: no dominant database signal.",
    signals.has("ui_changed") || signals.has("component_changed") || signals.has("page_or_screen_changed")
      ? "Frontend-related because UI, component, page/screen, route-view, style, or frontend-test signals were present."
      : "Not strongly frontend-related: no dominant UI signal.",
    signals.has("config_changed") || signals.has("ci_changed") || signals.has("docker_changed") || signals.has("terraform_or_infra_changed")
      ? "Config/infra-related because config, dependency, CI, Docker, Terraform, or deployment signals were present."
      : "Not strongly config/infra-related: no dominant config or infrastructure signal."
  ];
}
