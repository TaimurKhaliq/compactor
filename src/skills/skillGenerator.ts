import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createSkillMetadata,
  renderAgentsMarkdownFromMetadata,
  renderSkillBanner,
  writeSkillMetadata
} from "./lifecycle.js";
import type { CandidateSkill, GenerationResult, MiningResult, ScanResult, SkillMetadata } from "../types.js";

interface CleanupResult {
  preservedMetadata: SkillMetadata[];
  archivedSkillCount: number;
}

export function generateSkillDrafts(scan: ScanResult, mining: MiningResult): GenerationResult {
  const compactorDir = join(scan.repoRoot, ".compactor");
  const skillsDir = join(compactorDir, "skills");
  const draftSkillsDir = join(compactorDir, "draft-skills");
  const patternsDir = join(compactorDir, "patterns");
  const now = new Date().toISOString();
  const cleanup = cleanGeneratedOutput(scan.repoRoot, now);
  const skillCandidates = mining.candidates.filter((candidate) => candidate.promotion_level === "agent_ready");
  const draftCandidates = mining.candidates.filter((candidate) => candidate.promotion_level === "draft");
  const patternCandidates = mining.candidates.filter((candidate) => candidate.promotion_level === "pattern_candidate");
  const preservedSkillIds = new Set(cleanup.preservedMetadata.map((metadata) => metadata.skill_id));
  const writableSkillCandidates = skillCandidates.filter((candidate) => !preservedSkillIds.has(candidate.id));
  const generatedMetadata: SkillMetadata[] = [];
  const draftMetadata: SkillMetadata[] = [];

  const skillFiles = writableSkillCandidates.map((candidate) => {
    mkdirSync(skillsDir, { recursive: true });
    const skillDir = join(skillsDir, candidate.id);
    mkdirSync(skillDir, { recursive: true });
    const metadata = createSkillMetadata(scan, candidate, now);
    generatedMetadata.push(metadata);
    const skillPath = join(skillDir, "SKILL.md");
    writeFileSync(skillPath, renderSkillMarkdown(candidate, metadata), "utf8");
    const metadataPath = writeSkillMetadata(skillDir, metadata);
    return {
      skillId: candidate.id,
      path: skillPath,
      metadataPath
    };
  });

  const draftSkillFiles = draftCandidates.map((candidate) => {
    mkdirSync(draftSkillsDir, { recursive: true });
    const skillDir = join(draftSkillsDir, candidate.id);
    mkdirSync(skillDir, { recursive: true });
    const metadata = createSkillMetadata(scan, candidate, now);
    draftMetadata.push(metadata);
    const skillPath = join(skillDir, "SKILL.md");
    writeFileSync(skillPath, renderSkillMarkdown(candidate, metadata), "utf8");
    const metadataPath = writeSkillMetadata(skillDir, metadata);
    return {
      skillId: candidate.id,
      path: skillPath,
      metadataPath
    };
  });

  const patternFiles = patternCandidates.map((candidate) => {
    mkdirSync(patternsDir, { recursive: true });
    const patternDir = join(patternsDir, candidate.id);
    mkdirSync(patternDir, { recursive: true });
    const patternPath = join(patternDir, "PATTERN.md");
    writeFileSync(patternPath, renderPatternMarkdown(candidate), "utf8");
    return {
      patternId: candidate.id,
      path: patternPath
    };
  });

  const agentsPath = join(compactorDir, "AGENTS.md");
  writeFileSync(agentsPath, renderAgentsMarkdownFromMetadata(scan, [...cleanup.preservedMetadata, ...generatedMetadata, ...draftMetadata], patternCandidates), "utf8");

  return {
    repoRoot: scan.repoRoot,
    generatedAt: now,
    agentsPath,
    skillFiles,
    draftSkillFiles,
    patternFiles,
    archivedSkillCount: cleanup.archivedSkillCount
  };
}

function cleanGeneratedOutput(repoRoot: string, now: string): CleanupResult {
  const compactorDir = join(repoRoot, ".compactor");
  const skillsDir = join(compactorDir, "skills");
  const patternsDir = join(compactorDir, "patterns");
  const draftSkillsDir = join(compactorDir, "draft-skills");
  const archiveSkillsDir = join(compactorDir, "archive", "skills");
  const preservedMetadata: SkillMetadata[] = [];
  let archivedSkillCount = 0;

  rmSync(patternsDir, { recursive: true, force: true });
  rmSync(draftSkillsDir, { recursive: true, force: true });

  for (const entry of readdirSafe(skillsDir)) {
    const skillDir = join(skillsDir, entry);
    const metadata = readMetadataSafe(join(skillDir, "metadata.json"));
    if (metadata && shouldPreserveSkill(metadata)) {
      preservedMetadata.push(metadata);
      continue;
    }

    mkdirSync(archiveSkillsDir, { recursive: true });
    renameSync(skillDir, uniqueArchivePath(archiveSkillsDir, entry, now));
    archivedSkillCount += 1;
  }

  if (isDirectoryEmpty(skillsDir)) {
    rmSync(skillsDir, { recursive: true, force: true });
  }

  return {
    preservedMetadata,
    archivedSkillCount
  };
}

function shouldPreserveSkill(metadata: SkillMetadata): boolean {
  return metadata.human_approved === true || metadata.managed_by === "human";
}

function readMetadataSafe(path: string): SkillMetadata | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SkillMetadata;
  } catch {
    return undefined;
  }
}

function readdirSafe(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function uniqueArchivePath(archiveSkillsDir: string, skillDirName: string, now: string): string {
  const base = `${skillDirName}-${safeTimestamp(now)}`;
  let candidate = join(archiveSkillsDir, base);
  let suffix = 2;
  while (existsSync(candidate)) {
    candidate = join(archiveSkillsDir, `${base}-${suffix}`);
    suffix += 1;
  }
  return candidate;
}

function isDirectoryEmpty(path: string): boolean {
  try {
    return readdirSync(path).length === 0;
  } catch {
    return true;
  }
}

function safeTimestamp(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
}

export function renderSkillMarkdown(candidate: CandidateSkill, metadata = createSkillMetadataForRender(candidate)): string {
  return [
    renderSkillBanner(metadata).trimEnd(),
    "",
    `# ${candidate.name}`,
    "",
    `Pattern confidence: ${formatConfidence(candidate.patternConfidence)}`,
    `Naming confidence: ${formatConfidence(candidate.namingConfidence)}`,
    ...(candidate.learnedSurface ? ["", "This skill is based on a learned implementation surface."] : []),
    "",
    "## When to use",
    renderWhenToUse(candidate),
    ...(candidate.learnedSurface ? ["", "## Learned surface", ...renderLearnedSurface(candidate)] : []),
    "",
    "## Relevant examples",
    ...renderRelevantExamples(candidate),
    "",
    "## Workflow",
    ...renderWorkflow(candidate),
    "",
    "## Validation",
    ...renderValidation(candidate),
    "",
    "## Evidence",
    ...candidate.evidenceCommits.slice(0, 5).map(renderEvidenceCommit),
    "",
    "## Human review",
    ...renderHumanReview(candidate),
    ""
  ].join("\n");
}

function createSkillMetadataForRender(candidate: CandidateSkill) {
  return createSkillMetadata(
    {
      repoRoot: "",
      packageScripts: [],
      validationCommands: candidate.suggestedValidationCommands,
      generatedAt: new Date().toISOString(),
      commitsAnalyzed: candidate.evidenceCommits.length,
      commits: [],
      repeatedPathPatterns: []
    },
    candidate
  );
}

export function renderAgentsMarkdown(scan: ScanResult, mining: MiningResult): string {
  const skillCandidates = mining.candidates.filter((candidate) => candidate.outputType === "skill");
  const patternCandidates = mining.candidates.filter((candidate) => candidate.outputType === "pattern");
  const candidateLines =
    skillCandidates.length === 0
      ? ["- No repeated skill candidates were found in the scanned commit range yet."]
      : skillCandidates.map(
          (candidate) =>
            `- ${candidate.name}: ${candidate.taskDescription ?? `Use this for ${taskPhrase(candidate)} changes.`} Use .compactor/skills/${candidate.id}/SKILL.md.`
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
    "## Pattern candidates needing review",
    ...(patternCandidates.length === 0 ? ["- None"] : patternCandidates.map((candidate) => `- ${candidate.name}: review .compactor/patterns/${candidate.id}/PATTERN.md.`)),
    "",
    "## Scan summary",
    `- Commits analyzed: ${scan.commitsAnalyzed}`,
    `- Repeated path patterns: ${scan.repeatedPathPatterns.length}`,
    `- Generated at: ${new Date().toISOString()}`,
    ""
  ].join("\n");
}

function renderWhenToUse(candidate: CandidateSkill): string {
  if (candidate.taskDescription) {
    return toWhenToUse(candidate.taskDescription);
  }

  const task = taskPhrase(candidate);
  const examples = examplePhrase(candidate);
  return `Use this when modifying ${task}${examples ? `, such as ${examples}` : ""}.`;
}

function renderLearnedSurface(candidate: CandidateSkill): string[] {
  const surface = candidate.learnedSurface;
  if (!surface) {
    return [];
  }

  const lines = [
    `- Surface: ${surface.commonDirectory}`,
    `- Display name: ${surface.displayName}`,
    ...(surface.taskKind ? [`- Task kind: ${surface.taskKind}`] : []),
    `- Match confidence: ${formatConfidence(surface.confidence)}`,
    `- Commit match share: ${formatConfidence(surface.matchShare)}`,
    `- Evidence used: ${candidate.surfaceRelevantCommitCount ?? candidate.evidenceCommits.length} surface-relevant commits from ${candidate.rawEvidenceCommitCount ?? candidate.evidenceCommits.length} broad-cluster commits`,
    `- Rejected evidence: ${candidate.rejectedEvidenceCommitCount ?? 0} noisy or unrelated commits`
  ];

  if (surface.representativeFiles.length > 0) {
    lines.push("- Representative source files:");
    lines.push(...surface.representativeFiles.slice(0, 5).map((file) => `  - ${file}`));
  }

  if (surface.coChangingTestFiles.length > 0) {
    lines.push("- Co-changing tests:");
    lines.push(...surface.coChangingTestFiles.slice(0, 5).map((file) => `  - ${file}`));
  }

  if (surface.validationCommands.length > 0) {
    lines.push("- Validation:");
    lines.push(...surface.validationCommands.map((command) => `  - ${command}`));
  }

  if (surface.repeatedTerms.length > 0) {
    lines.push(`- Repeated terms: ${surface.repeatedTerms.slice(0, 6).join(", ")}`);
  }

  if (surface.coChangeEvidence.length > 0) {
    lines.push(`- Strong co-change: ${surface.coChangeEvidence[0]?.files.join(" + ")} (${surface.coChangeEvidence[0]?.weight} commits)`);
  }

  return lines;
}

function toWhenToUse(taskDescription: string): string {
  if (/reporting dashboard\/workbench UI changes/i.test(taskDescription)) {
    return "Use this when modifying the reporting dashboard, workbench UI, API client wiring, or related UI tests.";
  }

  const body = taskDescription
    .replace(/^Use this for\s+/i, "")
    .replace(/\schanges involving\s/i, " work involving ")
    .replace(/\.$/, "");
  return `Use this when modifying ${body}.`;
}

function renderRelevantExamples(candidate: CandidateSkill): string[] {
  const examples = selectedExampleFiles(candidate);
  if (examples.length === 0) {
    return ["- No stable source examples survived generated-artifact filtering."];
  }
  return examples.map((file) => `- ${file}`);
}

function selectedExampleFiles(candidate: CandidateSkill): string[] {
  const ordered = prioritizedExampleFiles(candidate);
  const sources = ordered.filter(isRenderableSourceFile);
  const tests = ordered.filter(isRenderableTestFile);
  const other = ordered.filter((file) => !isRenderableSourceFile(file) && !isRenderableTestFile(file));
  const sourceLimit = tests.length > 0 ? 4 : 5;
  const selected = [
    ...sources.slice(0, sourceLimit),
    ...tests.slice(0, 5 - Math.min(sources.length, sourceLimit))
  ];

  return unique([...selected, ...other]).slice(0, 5);
}

function prioritizedExampleFiles(candidate: CandidateSkill): string[] {
  return exampleFilePool(candidate)
    .map((file, index) => ({ file, index, priority: examplePriority(candidate, file) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map((entry) => entry.file);
}

function exampleFilePool(candidate: CandidateSkill): string[] {
  return unique([
    ...(candidate.learnedSurface?.representativeFiles ?? []),
    ...(candidate.learnedSurface?.coChangingTestFiles ?? []),
    ...candidate.commonFiles,
    ...candidate.evidenceCommits.flatMap((commit) => commit.changedFiles)
  ]);
}

function examplePriority(candidate: CandidateSkill, file: string): number {
  const lower = file.toLowerCase();
  const surface = candidate.learnedSurface;

  if (surface) {
    if (surface.representativeFiles.includes(file) && isRenderableSourceFile(lower)) return 0;
    if (surface.coChangingTestFiles.includes(file)) return 1;
    if (surface.coChangingConfigOrDocsFiles.includes(file)) return 3;
    if (isRenderableSourceFile(lower) && lower.startsWith(`${surface.commonDirectory.toLowerCase()}/`)) return 0;
    if (isRenderableSourceFile(lower)) return 2;
    if (isRenderableTestFile(lower)) return 3;
    return 4;
  }

  if (candidate.primaryArea === "frontend") {
    if (/(^|\/)(ui|frontend|client|web)\/src\/components?\//.test(lower) || /(^|\/)src\/components?\//.test(lower)) return 0;
    if (/(^|\/)(ui|frontend|client|web)\/src\/(app|pages?|screens?|views?)\//.test(lower)) return 1;
    if (/(^|\/)(ui|frontend|client|web)\/src\/api(?:\.|\/)/.test(lower)) return 2;
    if (/\.(css|scss|sass|less)$/.test(lower)) return 3;
    if (isRenderableSourceFile(lower)) return 4;
    if (isRenderableTestFile(lower)) return 5;
    return 5;
  }

  if (candidate.primaryArea === "cli") {
    if (/(^|\/)(cli|commands?)\//.test(lower) || /(^|\/)cli\.(tsx?|jsx?|py|go|rs|cs)$/.test(lower)) return 0;
    if (isRenderableSourceFile(lower)) return 1;
    if (isRenderableTestFile(lower)) return 2;
    return 3;
  }

  if (candidate.primaryArea === "backend") {
    if (/(^|\/)(routes?|controllers?|handlers?|server)\//.test(lower)) return 0;
    if (/(^|\/)(services?|repositories?|dao|middleware)\//.test(lower)) return 1;
    if (isRenderableSourceFile(lower)) return 2;
    if (isRenderableTestFile(lower)) return 3;
    return 4;
  }

  if (candidate.primaryArea === "db") {
    if (/(^|\/)(migrations?|db|database)\//.test(lower) || /\.(sql|prisma)$/.test(lower)) return 0;
    if (/(^|\/)(models?|entities?|repositories?)\//.test(lower)) return 1;
    if (isRenderableSourceFile(lower)) return 2;
    if (isRenderableTestFile(lower)) return 3;
    return 4;
  }

  if (isRenderableSourceFile(lower)) return 0;
  if (isRenderableTestFile(lower)) return 1;
  return 2;
}

function isRenderableTestFile(file: string): boolean {
  return /(\.spec\.|\.(test|tests)\.|_(test|spec)\.)|(^|\/)(__tests__|tests?|specs?|e2e|playwright|cypress)(\/|$)/i.test(file);
}

function isRenderableSourceFile(file: string): boolean {
  return /\.(tsx?|jsx?|py|java|kt|cs|go|rs|sql|prisma)$/i.test(file) && !isRenderableTestFile(file);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function renderWorkflow(candidate: CandidateSkill): string[] {
  if (candidate.workflowProfile && candidate.workflowProfile.steps.length > 0 && !candidate.workflowProfile.usesGenericFallback) {
    return candidate.workflowProfile.steps.map((step, index) => `${index + 1}. ${step.text}${workflowEvidenceHint(step.count, step.files)}`);
  }

  if (candidate.learnedSurface?.taskKind === "commands") {
    return [
      "1. Start from the closest command module listed above.",
      "2. Update command behavior, argument handling, or option parsing in that module.",
      "3. Update shared command helpers only when the behavior requires it.",
      "4. Add or update the co-changing tests for the command path.",
      "5. Run the validation commands below."
    ];
  }

  if (candidate.learnedSurface?.taskKind === "ui") {
    return [
      "1. Start from the closest UI source example listed above.",
      "2. Update the component, screen, view, or client wiring in the learned surface.",
      "3. Keep generated, docs, or config updates secondary to the source change.",
      "4. Add or update the co-changing UI tests.",
      "5. Run the validation commands below."
    ];
  }

  if (candidate.learnedSurface?.taskKind === "api") {
    return [
      "1. Start from the closest route, controller, handler, or server module listed above.",
      "2. Update the API behavior in the learned surface.",
      "3. Update shared helpers only when the API behavior requires it.",
      "4. Add or update the co-changing tests.",
      "5. Run the validation commands below."
    ];
  }

  const sourceStep = workflowSourceStep(candidate);
  const testStep = candidate.genericSignals.some((signal) => signal.includes("test"))
    ? "Update the matching tests beside the nearest example."
    : "Add or update tests when the behavior changes.";
  return [
    "1. Start from the nearest relevant example listed above.",
    `2. ${sourceStep}`,
    `3. ${testStep}`,
    "4. Update docs or configuration only when the behavior change requires it.",
    "5. Run the validation commands below and review any changed generated artifacts separately."
  ];
}

function workflowEvidenceHint(count: number, files: string[]): string {
  const parts = [
    count > 0 ? `Observed in ${count} ${count === 1 ? "commit" : "commits"}` : "",
    files.length > 0 ? `common files: ${files.slice(0, 2).join(", ")}` : ""
  ].filter(Boolean);

  return parts.length > 0 ? ` (${parts.join("; ")}).` : "";
}

function renderValidation(candidate: CandidateSkill): string[] {
  if (candidate.suggestedValidationCommands.length === 0) {
    return ["- No confident validation command discovered."];
  }

  return candidate.suggestedValidationCommands.map((command) => `- ${command}`);
}

function renderEvidenceCommit(commit: CandidateSkill["evidenceCommits"][number]): string {
  const label = commit.url ? `[${commit.shortHash}](${commit.url})` : `\`${commit.shortHash}\``;
  return `- ${label}: ${commit.message}`;
}

export function renderPatternMarkdown(candidate: CandidateSkill): string {
  const neutralName = neutralPatternName(candidate);
  return [
    `# Pattern Candidate: ${neutralName}`,
    "",
    "This is not a skill.",
    "",
    "It was not promoted because the cluster is too mixed or noisy for agent-ready guidance. Useful evidence may still exist, but a human should split it, approve it manually, or ignore it.",
    "",
    "## Why it was found",
    candidate.rationale,
    ...renderPatternFactors(candidate),
    "",
    "## Why it was not promoted",
    ...renderList(candidate.promotionReasons),
    "",
    "## Evidence",
    ...candidate.evidenceCommits.slice(0, 5).map(renderEvidenceCommit),
    "",
    "## Suggested human review action",
    "- Split it into smaller focused patterns if the evidence contains more than one task.",
    "- Approve it manually only after writing a concrete workflow and validation checklist.",
    "- Ignore it if the evidence is mostly generated, fixture, or incidental churn.",
    ""
  ].join("\n");
}

function renderPatternFactors(candidate: CandidateSkill): string[] {
  return candidate.confidenceFactors
    .filter((factor) => !/(domain terms used for name|generic fallback used|rejected noisy terms)/i.test(factor))
    .slice(0, 5)
    .map((factor) => `- ${factor}`);
}

function renderHumanReview(candidate: CandidateSkill): string[] {
  if (candidate.promotion_level === "draft") {
    return [
      "- Is the name correct?",
      "- Are the examples relevant?",
      "- Should this be approved, edited, or rejected?"
    ];
  }

  const notes = candidate.outputType === "skill"
    ? candidate.reviewNotes
    : ["This candidate was not promoted to a skill."];
  return renderList([...notes, ...candidate.falsePositiveNotes].slice(0, 5));
}

function taskPhrase(candidate: CandidateSkill): string {
  if (candidate.learnedSurface) {
    return `${candidate.learnedSurface.displayName} changes under ${candidate.learnedSurface.commonDirectory}`;
  }

  const domain = candidate.domainTerms.length > 0 ? `${candidate.domainTerms.join(" ")} ` : "";
  switch (candidate.primaryArea) {
    case "frontend":
      return `${domain}UI behavior or component code`.trim();
    case "backend":
      return `${domain}backend behavior or API code`.trim();
    case "db":
      return `${domain}database schema, model, or query code`.trim();
    case "infra":
      return `${domain}build, runtime, or infrastructure configuration`.trim();
    case "tests":
      return `${domain}test coverage or test fixtures`.trim();
    case "docs":
      return `${domain}documentation`.trim();
    case "cli":
      return `${domain}CLI commands, options, or command handlers`.trim();
    default:
      return "this repeated engineering pattern";
  }
}

function examplePhrase(candidate: CandidateSkill): string {
  const messageTerms = candidate.evidenceCommits
    .map((commit) => commit.message)
    .filter(Boolean)
    .slice(0, 2);
  const fileTerms = candidate.commonFiles
    .map((file) => file.split("/").pop() ?? file)
    .slice(0, 2);
  return [...messageTerms, ...fileTerms].slice(0, 3).join(", ");
}

function workflowSourceStep(candidate: CandidateSkill): string {
  if (candidate.learnedSurface) {
    return `Update the source files in the learned ${candidate.learnedSurface.displayName} under ${candidate.learnedSurface.commonDirectory}, starting from the representative examples.`;
  }

  switch (candidate.primaryArea) {
    case "frontend":
      return "Update the component, screen, route view, or style behavior using the existing local pattern.";
    case "backend":
      return "Update the route, controller, service, repository, or handler code that owns the behavior.";
    case "db":
      return "Update the migration, schema, model/entity, query, or seed data in the same style as the example.";
    case "infra":
      return "Update only the package, config, CI, Docker, deployment, or environment file that owns the change.";
    case "tests":
      return "Update the focused test cases and keep fixtures limited to the behavior under test.";
    case "docs":
      return "Update the documentation page or design note that owns the changed guidance.";
    case "cli":
      return "Update the command registration, option parsing, and command handler together.";
    default:
      return "Update the source behavior represented by the examples.";
  }
}

function neutralPatternName(candidate: CandidateSkill): string {
  const areas = patternAreas(candidate);
  const isMixed = candidate.primaryArea === "mixed" || candidate.primaryArea === "unknown" || candidate.primaryAreaShare < 0.6 || areas.length > 2;
  const domain = patternDomainHint(candidate);

  if (isMixed) {
    const areaLabel = areas.slice(0, 2).join("/") || "Change";
    return trimPatternName(`Mixed ${areaLabel}${domain ? ` ${domain}` : ""} Changes`);
  }

  if (candidate.primaryArea === "docs") return "Documentation Updates";
  if (candidate.primaryArea === "cli") return trimPatternName(`CLI${hasTestSignal(candidate) ? "/Test" : ""} Change Cluster`);
  if (candidate.primaryArea === "backend") return hasApiSignal(candidate) ? "Backend/API Change Cluster" : "Backend Change Cluster";
  if (candidate.primaryArea === "db") return "Database Change Cluster";
  if (candidate.primaryArea === "infra") return hasFixtureSignal(candidate) ? "Config/Fixture Change Cluster" : "Config Change Cluster";
  if (candidate.primaryArea === "frontend") return trimPatternName(`UI${hasTestSignal(candidate) ? "/Test" : ""}${domain ? ` ${domain}` : ""} Changes`);
  if (candidate.primaryArea === "tests") return "Test Change Cluster";

  return "Mixed Change Cluster";
}

function patternAreas(candidate: CandidateSkill): string[] {
  const labels = new Set<string>();
  for (const signal of candidate.genericSignals) {
    if (/^(ui|component|page_or_screen|route_view|style|frontend)/.test(signal)) labels.add("UI");
    if (/^(backend|api_route|controller|service_layer|repository_or_dao|middleware|auth|validation|serialization|background_job|queue_or_event_handler)/.test(signal)) labels.add(hasApiSignal(candidate) ? "Backend/API" : "Backend");
    if (/^(db|migration|schema|model_or_entity|seed_data|query|index)/.test(signal)) labels.add("Database");
    if (/^(config|env|package_or_dependency|package_script|ci|docker|terraform_or_infra|deployment)/.test(signal)) labels.add("Config");
    if (/(test|fixture)/.test(signal)) labels.add("Test");
    if (/^(docs|readme|adr_or_design_doc|changelog)/.test(signal)) labels.add("Docs");
    if (/^cli_command/.test(signal)) labels.add("CLI");
  }
  return [...labels].sort((a, b) => patternAreaPriority(a) - patternAreaPriority(b));
}

function patternAreaPriority(area: string): number {
  const index = ["UI", "Backend/API", "Backend", "CLI", "Test", "Database", "Config", "Docs"].indexOf(area);
  return index === -1 ? 99 : index;
}

function patternDomainHint(candidate: CandidateSkill): string {
  const terms = new Set(candidate.domainTerms.map((term) => term.toLowerCase()));
  if (terms.has("report") || terms.has("reporting")) return "Reporting";
  if (terms.has("audit")) return "Audit";
  return "";
}

function hasTestSignal(candidate: CandidateSkill): boolean {
  return candidate.genericSignals.some((signal) => /(test|fixture)/.test(signal));
}

function hasApiSignal(candidate: CandidateSkill): boolean {
  return candidate.genericSignals.includes("api_route_changed") || /API/.test(candidate.genericCategory);
}

function hasFixtureSignal(candidate: CandidateSkill): boolean {
  return candidate.genericSignals.includes("fixture_changed") || candidate.commonFiles.some((file) => /(^|\/)(fixtures?|snapshots?|baselines?)(\/|$)/i.test(file));
}

function trimPatternName(name: string): string {
  return name
    .replace(/\b(Add|Update|Feature|Skill)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 6)
    .join(" ");
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
