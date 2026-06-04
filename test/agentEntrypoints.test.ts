import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyAgentEntrypointsToRepo } from "../src/integrations/agentEntrypoints.js";
import type { SkillMetadata } from "../src/types.js";

test("creates AGENTS.md if missing", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-apply-codex-"));

  try {
    writeSkillMetadata(repoRoot, "skills", skillMetadata({ skill_id: "grid-ui", name: "Update Grid UI" }));
    const result = applyAgentEntrypointsToRepo(repoRoot, { target: "codex", now: "2026-01-01T00:00:00Z" });

    assert.equal(result.files.length, 1);
    assert.equal(result.files[0]?.action, "create");
    const agents = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");
    assert.match(agents, /<!-- COMPACTOR:START -->/);
    assert.match(agents, /Compactor mined this repository's Git history/);
    assert.match(agents, /\[Update Grid UI\]\(\.compactor\/skills\/grid-ui\/SKILL\.md\)/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("updates managed section without overwriting existing content", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-apply-preserve-"));

  try {
    writeSkillMetadata(repoRoot, "skills", skillMetadata({ skill_id: "api", name: "Update API Behavior" }));
    writeFileSync(
      join(repoRoot, "AGENTS.md"),
      [
        "# Team Instructions",
        "",
        "Keep this human-authored introduction.",
        "",
        "<!-- COMPACTOR:START -->",
        "old generated content",
        "<!-- COMPACTOR:END -->",
        "",
        "Keep this human-authored footer.",
        ""
      ].join("\n"),
      "utf8"
    );

    const result = applyAgentEntrypointsToRepo(repoRoot, { target: "codex" });
    const agents = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");

    assert.equal(result.files[0]?.action, "update");
    assert.match(agents, /Keep this human-authored introduction/);
    assert.match(agents, /Keep this human-authored footer/);
    assert.doesNotMatch(agents, /old generated content/);
    assert.match(agents, /\[Update API Behavior\]\(\.compactor\/skills\/api\/SKILL\.md\)/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("creates CLAUDE.md", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-apply-claude-"));

  try {
    applyAgentEntrypointsToRepo(repoRoot, { target: "claude" });

    const claude = readFileSync(join(repoRoot, "CLAUDE.md"), "utf8");
    assert.match(claude, /^# CLAUDE\.md/);
    assert.match(claude, /When using a Compactor skill, say: Used Compactor skill: <skill name>\./);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("creates Cursor rule file", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-apply-cursor-"));

  try {
    const result = applyAgentEntrypointsToRepo(repoRoot, { target: "cursor" });
    const cursor = readFileSync(join(repoRoot, ".cursor", "rules", "compactor.mdc"), "utf8");

    assert.equal(result.files[0]?.target, "cursor");
    assert.match(cursor, /^---\ndescription: Use Compactor-mined repository skills when relevant\./);
    assert.match(cursor, /alwaysApply: true/);
    assert.match(cursor, /<!-- COMPACTOR:START -->/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("creates Copilot instructions file", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-apply-copilot-"));

  try {
    const result = applyAgentEntrypointsToRepo(repoRoot, { target: "copilot" });
    const copilot = readFileSync(join(repoRoot, ".github", "copilot-instructions.md"), "utf8");

    assert.equal(result.files[0]?.target, "copilot");
    assert.match(copilot, /^# GitHub Copilot Instructions/);
    assert.match(copilot, /### Safety note/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("dry run changes nothing", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-apply-dry-run-"));

  try {
    const result = applyAgentEntrypointsToRepo(repoRoot, { target: "all", dryRun: true });

    assert.equal(result.files.length, 4);
    assert.ok(result.files.every((file) => file.changed));
    assert.equal(existsSync(join(repoRoot, "AGENTS.md")), false);
    assert.equal(existsSync(join(repoRoot, "CLAUDE.md")), false);
    assert.equal(existsSync(join(repoRoot, ".cursor", "rules", "compactor.mdc")), false);
    assert.equal(existsSync(join(repoRoot, ".github", "copilot-instructions.md")), false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("only approved skills are listed as primary", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-apply-approved-"));

  try {
    writeSkillMetadata(repoRoot, "skills", skillMetadata({ skill_id: "fresh", name: "Fresh Skill" }));
    writeSkillMetadata(repoRoot, "skills", skillMetadata({ skill_id: "stale", name: "Stale Skill", status: "stale", promotion_level: "pattern_candidate" }));
    writeSkillMetadata(repoRoot, "skills", skillMetadata({ skill_id: "deprecated", name: "Deprecated Skill", status: "deprecated" }));
    writeSkillMetadata(repoRoot, "draft-skills", skillMetadata({ skill_id: "draft", name: "Draft Skill", status: "draft", promotion_level: "draft" }));

    applyAgentEntrypointsToRepo(repoRoot, { target: "codex" });
    const agents = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");
    const approvedSection = sectionBetween(agents, "### Approved skills", "### Draft skills");

    assert.match(approvedSection, /Fresh Skill/);
    assert.doesNotMatch(approvedSection, /Stale Skill|Deprecated Skill|Draft Skill/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("draft skills are listed separately", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-apply-drafts-"));

  try {
    writeSkillMetadata(repoRoot, "draft-skills", skillMetadata({ skill_id: "draft-grid", name: "Draft Grid Skill", status: "draft", promotion_level: "draft" }));

    applyAgentEntrypointsToRepo(repoRoot, { target: "codex" });
    const agents = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");
    const draftSection = sectionBetween(agents, "### Draft skills", "### Pattern candidates");

    assert.match(draftSection, /\[Draft Grid Skill\]\(\.compactor\/draft-skills\/draft-grid\/SKILL\.md\)/);
    assert.match(draftSection, /Use only as supporting context/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("patterns are not listed as usable skills", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-apply-patterns-"));

  try {
    writeSkillMetadata(repoRoot, "skills", skillMetadata({ skill_id: "approved", name: "Approved Skill" }));
    mkdirSync(join(repoRoot, ".compactor", "patterns", "mixed-ui-test"), { recursive: true });
    writeFileSync(join(repoRoot, ".compactor", "patterns", "mixed-ui-test", "PATTERN.md"), "# Pattern Candidate: Mixed UI/Test\n", "utf8");

    const result = applyAgentEntrypointsToRepo(repoRoot, { target: "codex" });
    const agents = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");
    const approvedSection = sectionBetween(agents, "### Approved skills", "### Draft skills");
    const patternSection = sectionBetween(agents, "### Pattern candidates", "### Safety note");

    assert.equal(result.patternCandidateCount, 1);
    assert.doesNotMatch(approvedSection, /mixed-ui-test|Pattern Candidate/);
    assert.doesNotMatch(patternSection, /mixed-ui-test|Mixed UI\/Test/);
    assert.match(patternSection, /\.compactor\/patterns/);
    assert.match(patternSection, /not agent-ready skills/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

function writeSkillMetadata(repoRoot: string, tier: "skills" | "draft-skills", metadata: SkillMetadata): void {
  const skillDir = join(repoRoot, ".compactor", tier, metadata.skill_id);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
}

function skillMetadata(overrides: Partial<SkillMetadata>): SkillMetadata {
  return {
    skill_id: "example",
    name: "Example Skill",
    task_description: "Use this for example work.",
    created_at: "2026-01-01T00:00:00Z",
    generated_from_head: "abc123",
    evidence_commits: [],
    pattern_signature: {
      hash: "signature",
      generic_signals: [],
      common_directories: [],
      repeated_file_terms: [],
      dominant_domain_terms: [],
      validation_commands: []
    },
    generic_signals: [],
    dominant_terms: [],
    validation_commands: [],
    pattern_confidence: 0.9,
    naming_confidence: 0.9,
    promotion_level: "agent_ready",
    workflow_quality: 0.9,
    status: "fresh",
    last_refreshed_at: "2026-01-01T00:00:00Z",
    managed_by: "compactor",
    human_approved: false,
    validation_warnings: [],
    drift_reasons: [],
    ...overrides
  };
}

function sectionBetween(markdown: string, startHeading: string, endHeading: string): string {
  const start = markdown.indexOf(startHeading);
  const end = markdown.indexOf(endHeading);
  assert.ok(start >= 0, `Missing heading: ${startHeading}`);
  assert.ok(end > start, `Missing heading after ${startHeading}: ${endHeading}`);
  return markdown.slice(start, end);
}
