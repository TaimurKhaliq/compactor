#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { minePatterns } from "./analysis/patternMiner.js";
import { scanRepository } from "./git/history.js";
import { prepareRepository } from "./git/repository.js";
import { applyAgentEntrypoints, refreshExistingAgentEntrypoints } from "./integrations/agentEntrypoints.js";
import { generateSkillExplanation } from "./report/explainGenerator.js";
import { generateReport } from "./report/reportGenerator.js";
import { generateSkillDrafts } from "./skills/skillGenerator.js";
import {
  approveSkill,
  deprecateSkill,
  promotePatternToDraft,
  rejectDraftSkill,
  renameDraftSkill,
  renderSkillReviewDashboard,
  refreshSkills,
  renderLifecycleReport,
  reviewSkills,
  validateSkills
} from "./skills/lifecycle.js";
import type { AgentIntegrationResult, AgentIntegrationTarget, MiningResult, ScanResult } from "./types.js";

interface CliOptions {
  repo?: string;
  limit: number;
  json: boolean;
  help: boolean;
}

interface ApplyCliOptions {
  repo?: string;
  target: AgentIntegrationTarget;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

interface RepoOnlyCliOptions {
  repo?: string;
  json: boolean;
  help: boolean;
}

const DEFAULT_LIMIT = 50;

function main(): void {
  const [command = "help", ...args] = process.argv.slice(2);

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "explain") {
    const { skillId, options } = parseExplainArgs(args);
    if (options.help) {
      printHelp();
      return;
    }
    runExplain(skillId, options);
    return;
  }

  if (command === "approve" || command === "deprecate") {
    const { skillId, options } = parseSkillActionArgs(args, command);
    if (options.help) {
      printHelp();
      return;
    }
    if (command === "approve") {
      runApprove(skillId, options);
      return;
    }
    runDeprecate(skillId, options);
    return;
  }

  if (command === "reject") {
    const { skillId, options } = parseSkillActionArgs(args, command);
    if (options.help) {
      printHelp();
      return;
    }
    runReject(skillId, options);
    return;
  }

  if (command === "promote-pattern" || command === "rename-draft") {
    const { id, name, options } = parseNamedActionArgs(args, command);
    if (options.help) {
      printHelp();
      return;
    }
    if (command === "promote-pattern") {
      runPromotePattern(id, name, options);
      return;
    }
    runRenameDraft(id, name, options);
    return;
  }

  if (command === "apply") {
    const options = parseApplyArgs(args);
    if (options.help) {
      printHelp();
      return;
    }
    runApply(options);
    return;
  }

  if (command === "review") {
    const options = parseRepoOnlyArgs(args);
    if (options.help) {
      printHelp();
      return;
    }
    runReview(options);
    return;
  }

  const options = parseOptions(args);
  if (options.help) {
    printHelp();
    return;
  }

  switch (command) {
    case "scan":
      runScan(options);
      return;
    case "mine":
      runMine(options);
      return;
    case "generate":
      runGenerate(options);
      return;
    case "report":
      runReport(options);
      return;
    case "analyze":
      runAnalyze(options);
      return;
    case "refresh":
      runRefresh(options);
      return;
    case "validate-skills":
      runValidateSkills(options);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function runScan(options: CliOptions): void {
  const scan = scanAndCache(options);

  if (options.json) {
    printJson(scan);
    return;
  }

  console.log(`Scanned ${scan.commitsAnalyzed} commits in ${scan.repoRoot}`);
  console.log(`Repeated path patterns: ${scan.repeatedPathPatterns.length}`);
  console.log(`Cache written to ${cachePath(scan.repoRoot, "scan-result.json")}`);
}

function runMine(options: CliOptions): void {
  const scan = scanAndCache(options);
  const mining = mineAndCache(scan);

  if (options.json) {
    printJson(mining);
    return;
  }

  console.log(`Mined ${mining.candidates.length} candidates from ${scan.commitsAnalyzed} commits`);
  for (const candidate of mining.candidates) {
    console.log(`- ${candidate.name} [${candidate.outputType}] (${Math.round(candidate.confidence * 100)}%): ${candidate.evidenceCommits.length} commits`);
  }
  console.log(`Cache written to ${cachePath(scan.repoRoot, "candidate-skills.json")}`);
}

function runGenerate(options: CliOptions): void {
  const scan = scanAndCache(options);
  const mining = mineAndCache(scan);
  const result = generateSkillDrafts(scan, mining);
  writeCache(scan.repoRoot, "generation-result.json", result);

  if (options.json) {
    printJson(result);
    return;
  }

  console.log(`Generated AGENTS draft: ${result.agentsPath}`);
  printGeneratedFiles(result);
}

function runReport(options: CliOptions): void {
  const scan = scanAndCache(options);
  const mining = mineAndCache(scan);
  const report = generateReport(scan, mining);
  writeCache(scan.repoRoot, "report.txt", report);
  console.log(report);
}

function runAnalyze(options: CliOptions): void {
  const scan = scanAndCache(options);
  const mining = mineAndCache(scan);
  const generation = generateSkillDrafts(scan, mining);
  writeCache(scan.repoRoot, "generation-result.json", generation);
  const report = generateReport(scan, mining, { archivedSkillCount: generation.archivedSkillCount });
  writeCache(scan.repoRoot, "report.txt", report);

  if (options.json) {
    printJson({
      scan,
      mining,
      generation,
      report
    });
    return;
  }

  console.log(report);
  console.log(`Generated AGENTS draft: ${generation.agentsPath}`);
  printGeneratedFiles(generation);
}

function runExplain(skillId: string, options: CliOptions): void {
  const scan = scanAndCache(options);
  const mining = mineAndCache(scan);
  console.log(generateSkillExplanation(skillId, mining));
}

function runRefresh(options: CliOptions): void {
  const scan = scanAndCache(options);
  const report = refreshSkills(scan);
  const output = renderLifecycleReport(report);
  writeCache(scan.repoRoot, "skill-refresh-report.json", report);

  if (options.json) {
    printJson(report);
    return;
  }

  console.log(output);
}

function runValidateSkills(options: CliOptions): void {
  const scan = scanAndCache(options);
  const report = validateSkills(scan);
  const output = renderLifecycleReport(report);
  writeCache(scan.repoRoot, "skill-validation-report.json", report);

  if (options.json) {
    printJson(report);
    return;
  }

  console.log(output);
}

function runApply(options: ApplyCliOptions): void {
  const result = applyAgentEntrypoints({
    repo: options.repo,
    target: options.target,
    dryRun: options.dryRun
  });

  if (options.json) {
    printJson(result);
    return;
  }

  printApplyResult(result);
}

function runApprove(skillId: string, options: CliOptions): void {
  const repoRoot = resolveRepoRoot(options.repo);
  const draftPath = join(repoRoot, ".compactor", "draft-skills", skillId);
  const wasDraft = existsSync(draftPath);
  const metadata = approveSkill(repoRoot, skillId);
  const integration = refreshExistingAgentEntrypoints(repoRoot);

  if (options.json) {
    printJson({ metadata, integration });
    return;
  }

  console.log(`Approved skill: ${metadata.name}`);
  if (wasDraft) {
    console.log("Moved:");
    console.log(`.compactor/draft-skills/${metadata.skill_id}`);
    console.log("-> .compactor/skills/" + metadata.skill_id);
  }
  console.log("Updated .compactor/AGENTS.md");
  printIntegrationRefreshSummary(integration);
}

function runReject(skillId: string, options: CliOptions): void {
  const repoRoot = resolveRepoRoot(options.repo);
  const metadata = rejectDraftSkill(repoRoot, skillId);
  const integration = refreshExistingAgentEntrypoints(repoRoot);

  if (options.json) {
    printJson({ metadata, integration });
    return;
  }

  console.log(`Rejected draft skill: ${metadata.name}`);
  console.log(`Archived: .compactor/archive/rejected-skills/${metadata.skill_id}`);
  console.log("Updated .compactor/AGENTS.md");
  printIntegrationRefreshSummary(integration);
}

function runDeprecate(skillId: string, options: CliOptions): void {
  const repoRoot = resolveRepoRoot(options.repo);
  const metadata = deprecateSkill(repoRoot, skillId);
  const integration = refreshExistingAgentEntrypoints(repoRoot);

  if (options.json) {
    printJson({ metadata, integration });
    return;
  }

  console.log(`Deprecated skill: ${metadata.name}`);
  console.log(`Archived: .compactor/archive/deprecated-skills/${metadata.skill_id}`);
  console.log("Updated .compactor/AGENTS.md");
  printIntegrationRefreshSummary(integration);
}

function runPromotePattern(patternId: string, name: string, options: RepoOnlyCliOptions): void {
  const repoRoot = resolveRepoRoot(options.repo);
  const metadata = promotePatternToDraft(repoRoot, patternId, name);
  const integration = refreshExistingAgentEntrypoints(repoRoot);

  if (options.json) {
    printJson({ metadata, integration });
    return;
  }

  console.log(`Promoted pattern to draft skill: ${metadata.name}`);
  console.log(`Created: .compactor/draft-skills/${metadata.skill_id}`);
  console.log("Run: compactor approve " + metadata.skill_id);
  printIntegrationRefreshSummary(integration);
}

function runRenameDraft(skillId: string, name: string, options: RepoOnlyCliOptions): void {
  const repoRoot = resolveRepoRoot(options.repo);
  const metadata = renameDraftSkill(repoRoot, skillId, name);
  const integration = refreshExistingAgentEntrypoints(repoRoot);

  if (options.json) {
    printJson({ metadata, integration });
    return;
  }

  console.log(`Renamed draft skill: ${metadata.name}`);
  console.log(`Draft id: ${metadata.skill_id}`);
  console.log("Updated .compactor/AGENTS.md");
  printIntegrationRefreshSummary(integration);
}

function runReview(options: RepoOnlyCliOptions): void {
  const repoRoot = resolveRepoRoot(options.repo);
  const report = reviewSkills(repoRoot);

  if (options.json) {
    printJson(report);
    return;
  }

  console.log(renderSkillReviewDashboard(report));
}

function scanAndCache(options: CliOptions): ScanResult {
  const scan = scanRepository({
    repo: options.repo,
    limit: options.limit
  });
  writeCache(scan.repoRoot, "scan-result.json", scan);
  if (scan.repoLearning) {
    writeCache(scan.repoRoot, "repo-learning.json", scan.repoLearning);
  }
  if (scan.fingerprints) {
    writeCache(scan.repoRoot, "fingerprints.json", {
      fingerprints: scan.fingerprints,
      patternFamilies: scan.patternFamilies ?? []
    });
  }
  return scan;
}

function mineAndCache(scan: ScanResult): MiningResult {
  const mining = minePatterns(scan);
  writeCache(scan.repoRoot, "candidate-skills.json", mining);
  return mining;
}

function resolveRepoRoot(repo?: string): string {
  return prepareRepository({
    repo
  }).repoRoot;
}

function parseApplyArgs(args: string[]): ApplyCliOptions {
  const options: ApplyCliOptions = {
    target: "codex",
    dryRun: false,
    json: false,
    help: false
  };
  let targetProvided = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--target") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--target requires one of: codex, claude, cursor, copilot, all");
      }
      options.target = parseApplyTarget(value);
      targetProvided = true;
      index += 1;
      continue;
    }

    if (arg.startsWith("--target=")) {
      options.target = parseApplyTarget(arg.slice("--target=".length));
      targetProvided = true;
      continue;
    }

    if (arg === "--repo") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--repo requires a path");
      }
      options.repo = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--repo=")) {
      options.repo = arg.slice("--repo=".length);
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.repo) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    options.repo = arg;
  }

  if (!targetProvided && !options.help) {
    throw new Error("apply requires --target codex|claude|cursor|copilot|all");
  }

  return options;
}

function parseApplyTarget(value: string): AgentIntegrationTarget {
  if (value === "codex" || value === "claude" || value === "cursor" || value === "copilot" || value === "all") {
    return value;
  }

  throw new Error(`Invalid --target value: ${value}`);
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    limit: DEFAULT_LIMIT,
    json: false,
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--repo") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--repo requires a path");
      }
      options.repo = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--repo=")) {
      options.repo = arg.slice("--repo=".length);
      continue;
    }

    if (arg === "--limit" || arg === "-n") {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a number`);
      }
      options.limit = parseLimit(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      options.limit = parseLimit(arg.slice("--limit=".length));
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.repo) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    options.repo = arg;
  }

  return options;
}

function parseExplainArgs(args: string[]): { skillId: string; options: CliOptions } {
  let skillId: string | undefined;
  const optionArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      optionArgs.push(arg);
      continue;
    }

    if ((arg === "--repo" || arg === "--limit" || arg === "-n") && args[index + 1]) {
      optionArgs.push(arg, args[index + 1] as string);
      index += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      optionArgs.push(arg);
      continue;
    }

    if (!skillId) {
      skillId = arg;
      continue;
    }

    optionArgs.push(arg);
  }

  if (!skillId && !optionArgs.includes("--help") && !optionArgs.includes("-h")) {
    throw new Error("explain requires a skill id");
  }

  return {
    skillId: skillId ?? "",
    options: parseOptions(optionArgs)
  };
}

function parseSkillActionArgs(args: string[], command: string): { skillId: string; options: CliOptions } {
  let skillId: string | undefined;
  const optionArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      optionArgs.push(arg);
      continue;
    }

    if ((arg === "--repo" || arg === "--limit" || arg === "-n") && args[index + 1]) {
      optionArgs.push(arg, args[index + 1] as string);
      index += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      optionArgs.push(arg);
      continue;
    }

    if (!skillId) {
      skillId = arg;
      continue;
    }

    optionArgs.push(arg);
  }

  const options = parseOptions(optionArgs);
  if (!skillId && !options.help) {
    throw new Error(`${command} requires a skill id`);
  }

  return {
    skillId: skillId ?? "",
    options
  };
}

function parseNamedActionArgs(args: string[], command: string): { id: string; name: string; options: RepoOnlyCliOptions } {
  let id: string | undefined;
  let name: string | undefined;
  const optionArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === "--name") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--name requires a value");
      }
      name = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--name=")) {
      name = arg.slice("--name=".length);
      continue;
    }

    if (arg === "--help" || arg === "-h" || arg === "--json") {
      optionArgs.push(arg);
      continue;
    }

    if (arg === "--repo" && args[index + 1]) {
      optionArgs.push(arg, args[index + 1] as string);
      index += 1;
      continue;
    }

    if (arg.startsWith("--repo=")) {
      optionArgs.push(arg);
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (!id) {
      id = arg;
      continue;
    }

    optionArgs.push(arg);
  }

  const options = parseRepoOnlyArgs(optionArgs);
  if (!id && !options.help) {
    throw new Error(`${command} requires an id`);
  }
  if (!name && !options.help) {
    throw new Error(`${command} requires --name`);
  }

  return {
    id: id ?? "",
    name: name ?? "",
    options
  };
}

function parseRepoOnlyArgs(args: string[]): RepoOnlyCliOptions {
  const options: RepoOnlyCliOptions = {
    json: false,
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--repo") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--repo requires a path");
      }
      options.repo = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--repo=")) {
      options.repo = arg.slice("--repo=".length);
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.repo) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    options.repo = arg;
  }

  return options;
}

function parseLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid --limit value: ${value}`);
  }
  return parsed;
}

function writeCache(repoRoot: string, name: string, value: unknown): void {
  const target = cachePath(repoRoot, name);
  mkdirSync(join(repoRoot, ".compactor", "cache"), { recursive: true });
  const output = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  writeFileSync(target, output, "utf8");
}

function cachePath(repoRoot: string, name: string): string {
  return join(repoRoot, ".compactor", "cache", name);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printGeneratedFiles(result: ReturnType<typeof generateSkillDrafts>): void {
  if (result.archivedSkillCount > 0) {
    console.log(`Archived stale generated skills: ${result.archivedSkillCount}`);
  }

  if (result.skillFiles.length > 0) {
    console.log("Generated skill drafts:");
    for (const file of result.skillFiles) {
      console.log(`- ${file.path}`);
    }
  } else {
    console.log("No skill drafts promoted. Review pattern candidates for noisy or broad clusters.");
  }

  if (result.draftSkillFiles.length > 0) {
    console.log("Generated draft skills:");
    for (const file of result.draftSkillFiles) {
      console.log(`- ${file.path}`);
    }
  }

  if (result.patternFiles.length > 0) {
    console.log("Generated pattern candidates:");
    for (const file of result.patternFiles) {
      console.log(`- ${file.path}`);
    }
  }
}

function printApplyResult(result: AgentIntegrationResult): void {
  console.log(result.dryRun ? `Dry run for Compactor agent integration in ${result.repoRoot}` : `Applied Compactor agent integration in ${result.repoRoot}`);
  console.log(`Approved skills: ${result.approvedSkillCount}`);
  console.log(`Draft skills: ${result.draftSkillCount}`);
  console.log(`Pattern candidates: ${result.patternCandidateCount}`);

  for (const file of result.files) {
    const verb = result.dryRun && file.changed
      ? `would ${file.action}`
      : file.action;
    console.log(`- ${file.target}: ${verb} ${file.path}`);
  }
}

function printIntegrationRefreshSummary(result: AgentIntegrationResult): void {
  const changedFiles = result.files.filter((entry) => entry.changed);
  if (changedFiles.length === 0) {
    return;
  }

  console.log("Updated root integration files:");
  for (const file of changedFiles) {
    console.log(`- ${file.target}: ${file.path}`);
  }
}

function printHelp(): void {
  console.log(`compactor

Usage:
  compactor analyze [repo-url-or-path] [--limit 50] [--json]
  compactor apply [repo-url-or-path] --target codex|claude|cursor|copilot|all [--dry-run] [--json]
  compactor review [repo-url-or-path] [--json]
  compactor explain <skill-id> [repo-url-or-path] [--limit 50]
  compactor scan [--limit 50] [--repo path] [--json]
  compactor mine [--limit 50] [--repo path] [--json]
  compactor generate [--limit 50] [--repo path] [--json]
  compactor report [--limit 50] [--repo path]
  compactor refresh [repo-url-or-path] [--limit 50] [--json]
  compactor validate-skills [repo-url-or-path] [--limit 50] [--json]
  compactor approve <skill-id> [repo-url-or-path]
  compactor reject <skill-id> [repo-url-or-path]
  compactor deprecate <skill-id> [repo-url-or-path]
  compactor promote-pattern <pattern-id> --name "Skill name" [repo-url-or-path]
  compactor rename-draft <skill-id> --name "Skill name" [repo-url-or-path]

Commands:
  analyze   Run scan, mine, generate, and report in one shot
  apply     Write managed Compactor sections into agent instruction entrypoints
  review    Print skill review dashboard for drafts, patterns, and archives
  explain   Explain why a candidate skill was generated
  scan      Read recent git history and cache commit metadata
  mine      Detect repeated development patterns and cache skill candidates
  generate  Generate .compactor/skills/*/SKILL.md and .compactor/AGENTS.md
  report    Print a concise terminal report
  refresh   Re-source existing generated skills from newer commits
  validate-skills
            Report stale, drifting, deprecated, and review-needed skills
  approve   Move a draft skill into trusted, human-approved skills
  reject    Archive a draft skill as rejected
  deprecate Archive a trusted skill as deprecated
  promote-pattern
            Convert a pattern candidate into a named draft skill
  rename-draft
            Rename a draft skill and update its metadata
`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`compactor: ${message}`);
  process.exitCode = 1;
}
