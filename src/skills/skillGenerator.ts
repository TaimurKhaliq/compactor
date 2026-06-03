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
    `Confidence: ${formatConfidence(candidate.confidence)}`,
    "",
    "## When to use",
    renderWhenToUse(candidate),
    "",
    "## Examples",
    ...renderExamples(candidate).map((example) => `- ${example}`),
    "",
    "## Observed repo conventions",
    ...candidate.observedConventions.map((convention) => `- ${convention}`),
    "",
    "## Workflow",
    ...renderWorkflow(candidate).map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Validation",
    ...candidate.suggestedValidationCommands.map((command) => `- ${command}`),
    "- Review the changed files against the nearest existing example before handing off.",
    "",
    "## Evidence",
    ...candidate.evidenceCommits.map(renderEvidenceCommit),
    "",
    "## Common files and directories",
    ...renderCommonFiles(candidate),
    ""
  ].join("\n");
}

export function renderAgentsMarkdown(scan: ScanResult, mining: MiningResult): string {
  const candidateLines =
    mining.candidates.length === 0
      ? ["- No repeated skill candidates were found in the scanned commit range yet."]
      : mining.candidates.map(
          (candidate) =>
            `- ${candidate.name}: use .compactor/skills/${candidate.id}/SKILL.md when work matches ${candidate.matchedPatterns
              .slice(0, 3)
              .join(", ") || "the observed commit evidence"}.`
        );

  return [
    "# Compactor Draft Repo Guidance",
    "",
    "This draft was generated from local git history. Review it before copying guidance into a production AGENTS.md.",
    "",
    "## Repository guidance",
    "- Start from the nearest existing implementation before introducing a new pattern.",
    "- Keep generated agent instructions short, concrete, and tied to repository evidence.",
    "- Validate changes with the commands listed in the matching skill draft.",
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
  switch (candidate.id) {
    case "build-project-grid":
      return "Use this when implementing a new grid, table, search result screen, Kendo grid feature, or column-heavy UI.";
    case "add-or-update-tests":
      return "Use this when adding coverage for a feature, updating a spec after implementation changes, or extending e2e coverage.";
    case "update-runtime-configuration":
      return "Use this when changing environment files, JSON/YAML config, build config, or runtime settings.";
    case "add-angular-feature":
      return "Use this when adding or extending an Angular feature slice that touches component and service files together.";
    case "add-api-endpoint":
      return "Use this when adding a route, controller, resolver, endpoint handler, or API-facing feature with tests.";
    default:
      return `Use this when the task matches repeated history for ${candidate.name}.`;
  }
}

function renderExamples(candidate: CandidateSkill): string[] {
  const nearestFile = candidate.commonFiles[0] ? `\`${candidate.commonFiles[0]}\`` : "the nearest matching file";

  switch (candidate.id) {
    case "build-project-grid":
      return [
        `Add a new grid using ${nearestFile} as the closest example.`,
        "Change table columns, search behavior, pagination, or export behavior."
      ];
    case "add-or-update-tests":
      return [
        `Update coverage near ${nearestFile}.`,
        "Add a unit spec or e2e test for a changed user workflow."
      ];
    case "update-runtime-configuration":
      return [
        `Add or rename a config key in ${nearestFile}.`,
        "Keep related environment and JSON/YAML settings aligned."
      ];
    case "add-angular-feature":
      return [
        `Create a feature slice next to ${nearestFile}.`,
        "Update component TypeScript, template/style files, service logic, and nearby specs together."
      ];
    case "add-api-endpoint":
      return [
        `Add an endpoint using ${nearestFile} as the closest tested pattern.`,
        "Pair route/controller changes with API tests in the same workflow."
      ];
    default:
      return [`Follow the nearest example around ${nearestFile}.`];
  }
}

function renderWorkflow(candidate: CandidateSkill): string[] {
  switch (candidate.id) {
    case "build-project-grid":
      return [
        "Find the nearest existing grid or table implementation.",
        "Reuse the existing column definition and data loading pattern.",
        "Add search, reset, pagination, sorting, and export behavior only when the nearby example supports it.",
        "Keep template, component, service, and model changes in the same feature area.",
        "Add or update tests that cover the visible grid behavior."
      ];
    case "add-or-update-tests":
      return [
        "Identify the implementation files changed by the task.",
        "Find the closest existing spec or e2e example for the same area.",
        "Mirror the repository's assertion style, fixture setup, and naming pattern.",
        "Cover the changed behavior rather than only snapshotting structure.",
        "Run the narrow test first, then the broader validation command."
      ];
    case "update-runtime-configuration":
      return [
        "Find all environment/config files that define the same key family.",
        "Update related JSON/YAML/env files together.",
        "Check whether build, test, or deployment config needs the same setting.",
        "Avoid hard-coded values when an existing config access pattern exists.",
        "Run build validation to catch malformed config."
      ];
    case "add-angular-feature":
      return [
        "Find the nearest Angular feature folder with component and service files.",
        "Create or update the component TypeScript, template, styles, and service as one feature slice.",
        "Reuse existing dependency injection, observable, form, and state patterns.",
        "Add or update the companion .spec.ts file when nearby features have one.",
        "Run tests and lint before considering the feature complete."
      ];
    case "add-api-endpoint":
      return [
        "Find the closest existing endpoint with tests.",
        "Mirror route/controller naming, request parsing, response shape, and error handling.",
        "Keep service/repository calls consistent with nearby endpoints.",
        "Add or update API tests for success and important failure cases.",
        "Run the API test suite and lint."
      ];
    default:
      return [
        "Find the nearest existing implementation matching the evidence.",
        "Reuse its naming, file layout, and validation pattern.",
        "Update tests or config if the matching evidence usually includes them."
      ];
  }
}

function renderCommonFiles(candidate: CandidateSkill): string[] {
  const lines: string[] = [];

  if (candidate.commonFiles.length > 0) {
    lines.push("- Common files:");
    lines.push(...candidate.commonFiles.map((file) => `  - ${file}`));
  }

  if (candidate.commonDirectories.length > 0) {
    lines.push("- Common directories:");
    lines.push(...candidate.commonDirectories.map((directory) => `  - ${directory}`));
  }

  if (lines.length === 0) {
    return ["- No common files or directories were detected."];
  }

  return lines;
}

function renderEvidenceCommit(commit: CandidateSkill["evidenceCommits"][number]): string {
  const label = commit.url ? `[${commit.shortHash}](${commit.url})` : `\`${commit.shortHash}\``;
  return `- ${label}: ${commit.message}`;
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}
