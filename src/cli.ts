#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { minePatterns } from "./analysis/patternMiner.js";
import { scanRepository } from "./git/history.js";
import { generateSkillExplanation } from "./report/explainGenerator.js";
import { generateReport } from "./report/reportGenerator.js";
import { generateSkillDrafts } from "./skills/skillGenerator.js";
import {
  approveSkill,
  deprecateSkill,
  readSkillMetadata,
  refreshSkills,
  renderAgentsMarkdownFromMetadata,
  renderLifecycleReport,
  validateSkills
} from "./skills/lifecycle.js";
import type { MiningResult, ScanResult } from "./types.js";

interface CliOptions {
  repo?: string;
  limit: number;
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

  console.log(`Mined ${mining.candidates.length} candidate skills from ${scan.commitsAnalyzed} commits`);
  for (const candidate of mining.candidates) {
    console.log(`- ${candidate.name} (${Math.round(candidate.confidence * 100)}%): ${candidate.evidenceCommits.length} commits`);
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
  if (result.skillFiles.length === 0) {
    console.log("No skill drafts generated because no repeated candidates were found.");
    return;
  }

  console.log("Generated skill drafts:");
  for (const file of result.skillFiles) {
    console.log(`- ${file.path}`);
  }
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
  const report = generateReport(scan, mining);
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
  if (generation.skillFiles.length > 0) {
    console.log("Generated skill drafts:");
    for (const file of generation.skillFiles) {
      console.log(`- ${file.path}`);
    }
  } else {
    console.log("No skill drafts generated because no repeated candidates were found.");
  }
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

function runApprove(skillId: string, options: CliOptions): void {
  const scan = scanAndCache(options);
  const metadata = approveSkill(scan.repoRoot, skillId);
  writeFileSync(join(scan.repoRoot, ".compactor", "AGENTS.md"), renderAgentsMarkdownFromMetadata(scan, readSkillMetadata(scan.repoRoot)), "utf8");

  if (options.json) {
    printJson(metadata);
    return;
  }

  console.log(`Approved skill: ${metadata.name}`);
}

function runDeprecate(skillId: string, options: CliOptions): void {
  const scan = scanAndCache(options);
  const metadata = deprecateSkill(scan.repoRoot, skillId);
  writeFileSync(join(scan.repoRoot, ".compactor", "AGENTS.md"), renderAgentsMarkdownFromMetadata(scan, readSkillMetadata(scan.repoRoot)), "utf8");

  if (options.json) {
    printJson(metadata);
    return;
  }

  console.log(`Deprecated skill: ${metadata.name}`);
}

function scanAndCache(options: CliOptions): ScanResult {
  const scan = scanRepository({
    repo: options.repo,
    limit: options.limit
  });
  writeCache(scan.repoRoot, "scan-result.json", scan);
  return scan;
}

function mineAndCache(scan: ScanResult): MiningResult {
  const mining = minePatterns(scan);
  writeCache(scan.repoRoot, "candidate-skills.json", mining);
  return mining;
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

function printHelp(): void {
  console.log(`compactor

Usage:
  compactor analyze [repo-url-or-path] [--limit 50] [--json]
  compactor explain <skill-id> [repo-url-or-path] [--limit 50]
  compactor scan [--limit 50] [--repo path] [--json]
  compactor mine [--limit 50] [--repo path] [--json]
  compactor generate [--limit 50] [--repo path] [--json]
  compactor report [--limit 50] [--repo path]
  compactor refresh [repo-url-or-path] [--limit 50] [--json]
  compactor validate-skills [repo-url-or-path] [--limit 50] [--json]
  compactor approve <skill-id> [repo-url-or-path]
  compactor deprecate <skill-id> [repo-url-or-path]

Commands:
  analyze   Run scan, mine, generate, and report in one shot
  explain   Explain why a candidate skill was generated
  scan      Read recent git history and cache commit metadata
  mine      Detect repeated development patterns and cache skill candidates
  generate  Generate .compactor/skills/*/SKILL.md and .compactor/AGENTS.md
  report    Print a concise terminal report
  refresh   Re-source existing generated skills from newer commits
  validate-skills
            Report stale, drifting, deprecated, and review-needed skills
  approve   Mark a generated skill as human approved
  deprecate Mark a generated skill as deprecated
`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`compactor: ${message}`);
  process.exitCode = 1;
}
