#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { minePatterns } from "./analysis/patternMiner.js";
import { scanRepository } from "./git/history.js";
import { generateReport } from "./report/reportGenerator.js";
import { generateSkillDrafts } from "./skills/skillGenerator.js";
import type { MiningResult, ScanResult } from "./types.js";

interface CliOptions {
  repoPath: string;
  limit: number;
  json: boolean;
  help: boolean;
}

const DEFAULT_LIMIT = 50;

function main(): void {
  const [command = "help", ...args] = process.argv.slice(2);
  const options = parseOptions(args);

  if (options.help || command === "help" || command === "--help" || command === "-h") {
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

function scanAndCache(options: CliOptions): ScanResult {
  const scan = scanRepository({
    repoPath: options.repoPath,
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
    repoPath: process.cwd(),
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
      options.repoPath = resolve(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--repo=")) {
      options.repoPath = resolve(arg.slice("--repo=".length));
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

    throw new Error(`Unknown option: ${arg}`);
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

function printHelp(): void {
  console.log(`compactor

Usage:
  compactor scan [--limit 50] [--repo path] [--json]
  compactor mine [--limit 50] [--repo path] [--json]
  compactor generate [--limit 50] [--repo path] [--json]
  compactor report [--limit 50] [--repo path]

Commands:
  scan      Read recent git history and cache commit metadata
  mine      Detect repeated development patterns and cache skill candidates
  generate  Generate .compactor/skills/*/SKILL.md and .compactor/AGENTS.md
  report    Print a concise terminal report
`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`compactor: ${message}`);
  process.exitCode = 1;
}
