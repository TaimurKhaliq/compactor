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
    "## Nearest examples",
    ...renderNearestExamples(candidate),
    "",
    "## Observed changes",
    ...candidate.observedChanges.map((change) => `- ${change}`),
    "",
    "## Observed repo conventions",
    ...candidate.observedConventions.map((convention) => `- ${convention}`),
    "",
    "## Workflow",
    ...renderWorkflow(candidate).map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Validation",
    ...renderValidation(candidate),
    "",
    "## Evidence",
    ...candidate.evidenceCommits.slice(0, 5).map(renderEvidenceCommit),
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
    case "add-or-update-cli-feature":
      return "Use this when adding or changing a CLI command, CLI option, or command-line workflow.";
    case "add-or-update-ui-server-feature":
      return "Use this when changing the UI server together with UI implementation or UI tests.";
    case "add-or-update-product-analysis-feature":
      return "Use this when adding critic, audit, report, heuristic, or evidence-oriented product analysis behavior.";
    default:
      return `Use this when the task matches repeated history for ${candidate.name}.`;
  }
}

function renderNearestExamples(candidate: CandidateSkill): string[] {
  const examples = candidate.commonFiles.slice(0, 5);

  if (examples.length === 0) {
    return ["- No repeated nearest example files were detected."];
  }

  return examples.map((file) => `- ${file}`);
}

function renderWorkflow(candidate: CandidateSkill): string[] {
  switch (candidate.id) {
    case "build-project-grid":
      return [
        "Find the nearest existing grid or table implementation.",
        "Reuse the existing column definition and data loading pattern.",
        "Add search, reset, pagination, sorting, and export behavior only when the nearby example supports it.",
        "Keep template, component, service, and model changes in the same feature area.",
        "Add or update tests that cover the visible grid behavior when nearby examples include them.",
        "Run the available validation scripts listed below."
      ];
    case "add-or-update-tests":
      return [
        "Identify the implementation files changed by the task.",
        "Find the closest existing spec or e2e example for the same area.",
        "Mirror the repository's assertion style, fixture setup, and naming pattern.",
        "Cover the changed behavior rather than only snapshotting structure.",
        "Run the narrow test first when the repo exposes one, then the available validation scripts listed below."
      ];
    case "update-runtime-configuration":
      return [
        "Find all environment/config files that define the same key family.",
        "Update related JSON/YAML/env files together.",
        "Check whether build, test, or deployment config needs the same setting.",
        "Avoid hard-coded values when an existing config access pattern exists.",
        "Run the available validation scripts listed below to catch malformed config."
      ];
    case "add-angular-feature":
      return [
        "Find the nearest Angular feature folder with component and service files.",
        "Create or update the component TypeScript, template, styles, and service as one feature slice.",
        "Reuse existing dependency injection, observable, form, and state patterns.",
        "Add or update the companion .spec.ts file when nearby features have one.",
        "Run the available validation scripts listed below."
      ];
    case "add-api-endpoint":
      return [
        "Find the closest route or handler from the nearest examples.",
        "Mirror request parsing, response shape, and error handling.",
        "Update nearby tests when the evidence shows endpoint changes are tested together.",
        "Run the available validation scripts listed below."
      ];
    case "add-or-update-cli-feature":
      return [
        "Find the nearest command or option wiring.",
        "Mirror argument parsing, output formatting, and error handling.",
        "Update tests for the command behavior or option branch.",
        "Run the available validation scripts listed below."
      ];
    case "add-or-update-ui-server-feature":
      return [
        "Start from the nearest server/uiServer.ts handler or server-side UI helper.",
        "Keep UI server behavior aligned with the matching UI component or UI test.",
        "Update UI tests when the visible behavior changes.",
        "Run the available validation scripts listed below."
      ];
    case "add-or-update-product-analysis-feature":
      return [
        "Find the nearest critic, audit, report, heuristic, or evidence module.",
        "Reuse the existing input, scoring, evidence, and report-shape conventions.",
        "Update focused tests for the product-analysis behavior.",
        "Run the available validation scripts listed below."
      ];
    default:
      return [
        "Find the nearest existing implementation matching the evidence.",
        "Reuse its naming, file layout, and validation pattern.",
        "Update tests or config if the matching evidence usually includes them."
      ];
  }
}

function renderValidation(candidate: CandidateSkill): string[] {
  if (candidate.suggestedValidationCommands.length === 0) {
    return ["- No package.json validation scripts detected."];
  }

  return candidate.suggestedValidationCommands.map((command) => `- ${command}`);
}

function renderEvidenceCommit(commit: CandidateSkill["evidenceCommits"][number]): string {
  const label = commit.url ? `[${commit.shortHash}](${commit.url})` : `\`${commit.shortHash}\``;
  const signals = commit.diffSignals.length > 0 ? ` (${commit.diffSignals.slice(0, 2).join("; ")})` : "";
  return `- ${label}: ${commit.message}${signals}`;
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}
