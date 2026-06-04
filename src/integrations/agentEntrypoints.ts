import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { prepareRepository } from "../git/repository.js";
import { readDraftSkillMetadata, readSkillMetadata } from "../skills/lifecycle.js";
import type { AgentIntegrationFileChange, AgentIntegrationResult, AgentIntegrationTarget, SkillMetadata } from "../types.js";

type ConcreteTarget = Exclude<AgentIntegrationTarget, "all">;

export interface ApplyAgentEntrypointsOptions {
  repo?: string;
  cwd?: string;
  target: AgentIntegrationTarget;
  dryRun?: boolean;
}

export interface ApplyAgentEntrypointsToRepoOptions {
  target: AgentIntegrationTarget;
  dryRun?: boolean;
  now?: string;
}

interface EntrypointDefinition {
  target: ConcreteTarget;
  relativePath: string;
  createPrefix: string;
}

const START_MARKER = "<!-- COMPACTOR:START -->";
const END_MARKER = "<!-- COMPACTOR:END -->";

const TARGETS: Record<ConcreteTarget, EntrypointDefinition> = {
  codex: {
    target: "codex",
    relativePath: "AGENTS.md",
    createPrefix: "# AGENTS.md\n\n"
  },
  claude: {
    target: "claude",
    relativePath: "CLAUDE.md",
    createPrefix: "# CLAUDE.md\n\n"
  },
  cursor: {
    target: "cursor",
    relativePath: ".cursor/rules/compactor.mdc",
    createPrefix: [
      "---",
      "description: Use Compactor-mined repository skills when relevant.",
      "globs: \"**/*\"",
      "alwaysApply: true",
      "---",
      "",
      ""
    ].join("\n")
  },
  copilot: {
    target: "copilot",
    relativePath: ".github/copilot-instructions.md",
    createPrefix: "# GitHub Copilot Instructions\n\n"
  }
};

export function applyAgentEntrypoints(options: ApplyAgentEntrypointsOptions): AgentIntegrationResult {
  const target = prepareRepository({
    repo: options.repo,
    cwd: options.cwd
  });

  return applyAgentEntrypointsToRepo(target.repoRoot, {
    target: options.target,
    dryRun: options.dryRun
  });
}

export function applyAgentEntrypointsToRepo(repoRoot: string, options: ApplyAgentEntrypointsToRepoOptions): AgentIntegrationResult {
  const targets = expandTargets(options.target);
  const approvedSkills = approvedSkillMetadata(repoRoot);
  const draftSkills = draftSkillMetadata(repoRoot);
  const patternCandidateCount = countPatternCandidates(repoRoot);
  const section = renderManagedCompactorSection({
    approvedSkills,
    draftSkills,
    patternCandidateCount
  });

  const files = targets.map((target) => applyTarget(repoRoot, TARGETS[target], section, options.dryRun === true));

  return {
    repoRoot,
    generatedAt: options.now ?? new Date().toISOString(),
    dryRun: options.dryRun === true,
    target: options.target,
    approvedSkillCount: approvedSkills.length,
    draftSkillCount: draftSkills.length,
    patternCandidateCount,
    files
  };
}

export function refreshExistingAgentEntrypoints(repoRoot: string, now = new Date().toISOString()): AgentIntegrationResult {
  const existingTargets = expandTargets("all").filter((target) => existsSync(join(repoRoot, TARGETS[target].relativePath)));
  const approvedSkills = approvedSkillMetadata(repoRoot);
  const draftSkills = draftSkillMetadata(repoRoot);
  const patternCandidateCount = countPatternCandidates(repoRoot);
  const section = renderManagedCompactorSection({
    approvedSkills,
    draftSkills,
    patternCandidateCount
  });
  const files = existingTargets.map((target) => applyTarget(repoRoot, TARGETS[target], section, false));

  return {
    repoRoot,
    generatedAt: now,
    dryRun: false,
    target: "all",
    approvedSkillCount: approvedSkills.length,
    draftSkillCount: draftSkills.length,
    patternCandidateCount,
    files
  };
}

export function renderManagedCompactorSection(input: {
  approvedSkills: SkillMetadata[];
  draftSkills: SkillMetadata[];
  patternCandidateCount: number;
}): string {
  return [
    START_MARKER,
    "## Compactor Agent Guidance",
    "",
    "Compactor mined this repository's Git history and generated reusable agent guidance from repeated engineering patterns.",
    "",
    "### Usage protocol",
    "Before implementing a task, check the approved Compactor skills below. If a skill matches, follow its workflow and mention the skill used in your final response.",
    "",
    "### Approved skills",
    ...renderSkillLinks(input.approvedSkills, ".compactor/skills", "- No approved or agent-ready Compactor skills are available yet."),
    "",
    "### Draft skills needing human review. Use only as supporting context.",
    ...renderSkillLinks(input.draftSkills, ".compactor/draft-skills", "- None."),
    "",
    "### Pattern candidates",
    patternCandidateLine(input.patternCandidateCount),
    "",
    "### Safety note",
    "Do not treat generated skills as absolute truth. Prefer current code and tests when they conflict.",
    "",
    "### Usage confirmation",
    "When using a Compactor skill, say: Used Compactor skill: <skill name>.",
    END_MARKER,
    ""
  ].join("\n");
}

export function upsertManagedCompactorSection(existingContent: string, section: string): string {
  const start = existingContent.indexOf(START_MARKER);
  const end = existingContent.indexOf(END_MARKER);

  if (start === -1 && end === -1) {
    const prefix = existingContent.trimEnd();
    return prefix ? `${prefix}\n\n${section}` : section;
  }

  if (start === -1 || end === -1 || end < start) {
    throw new Error("Existing Compactor managed section markers are incomplete or out of order.");
  }

  const before = existingContent.slice(0, start).trimEnd();
  const after = existingContent.slice(end + END_MARKER.length).trimStart();
  return [before, section.trimEnd(), after].filter(Boolean).join("\n\n") + "\n";
}

function applyTarget(repoRoot: string, definition: EntrypointDefinition, section: string, dryRun: boolean): AgentIntegrationFileChange {
  const path = join(repoRoot, definition.relativePath);
  const exists = existsSync(path);
  const current = exists ? readFileSync(path, "utf8") : "";
  const next = exists
    ? upsertManagedCompactorSection(current, section)
    : `${definition.createPrefix}${section}`;
  const changed = current !== next;

  if (changed && !dryRun) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next, "utf8");
  }

  return {
    target: definition.target,
    path,
    action: exists ? (changed ? "update" : "unchanged") : "create",
    changed
  };
}

function expandTargets(target: AgentIntegrationTarget): ConcreteTarget[] {
  if (target === "all") {
    return ["codex", "claude", "cursor", "copilot"];
  }
  return [target];
}

function approvedSkillMetadata(repoRoot: string): SkillMetadata[] {
  return readSkillMetadata(repoRoot).filter((skill) => {
    if (skill.status === "deprecated" || skill.status === "rejected" || skill.status === "draft") {
      return false;
    }
    return skill.human_approved === true || (skill.status === "fresh" && skill.promotion_level === "agent_ready");
  });
}

function draftSkillMetadata(repoRoot: string): SkillMetadata[] {
  return readDraftSkillMetadata(repoRoot).filter((skill) => skill.status !== "deprecated" && skill.status !== "rejected" && (skill.status === "draft" || skill.promotion_level === "draft") && skill.human_approved !== true);
}

function countPatternCandidates(repoRoot: string): number {
  const patternsDir = join(repoRoot, ".compactor", "patterns");
  if (!existsSync(patternsDir)) {
    return 0;
  }

  return readdirSync(patternsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
}

function renderSkillLinks(skills: SkillMetadata[], basePath: string, emptyLine: string): string[] {
  if (skills.length === 0) {
    return [emptyLine];
  }

  return skills.map((skill) => {
    const description = skill.task_description ? ` - ${skill.task_description}` : "";
    return `- [${skill.name}](${basePath}/${skill.skill_id}/SKILL.md)${description}`;
  });
}

function patternCandidateLine(count: number): string {
  if (count === 0) {
    return "- No pattern candidates found.";
  }

  return `- ${count} pattern candidate${count === 1 ? "" : "s"} available in [.compactor/patterns/](.compactor/patterns/). These are not agent-ready skills.`;
}
