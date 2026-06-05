import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyCommit, collectRepeatedPathPatterns } from "../src/analysis/classifier.js";
import { learnImplementationFingerprints } from "../src/analysis/implementationFingerprints.js";
import { minePatterns } from "../src/analysis/patternMiner.js";
import { generateSkillExplanation } from "../src/report/explainGenerator.js";
import type { CommitMetadata, DiffSignal, ScanResult } from "../src/types.js";
import { diffSummaryWithSignals, emptyDiffSummary } from "./helpers.js";

test("Angular Kendo grids created in separate commits cluster together", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-fingerprint-kendo-"));

  try {
    for (const name of ["user", "profile", "account"]) {
      writeFile(repoRoot, `src/${name}-grid.component.ts`, angularKendoGrid(`${title(name)}GridComponent`));
    }

    const learning = learnImplementationFingerprints(repoRoot, separateCommits(["user", "profile", "account"].map((name) => `src/${name}-grid.component.ts`)));
    const family = learning.patternFamilies.find((candidate) => candidate.name === "Kendo Grid Components");

    assert.ok(family, "Expected Kendo grid pattern family");
    assert.equal(family.fileCount, 3);
    assert.ok(family.confidence >= 0.85);
    assert.deepEqual(family.frameworks, ["angular"]);
    assert.ok(family.libraries.includes("kendo-angular-grid"));
    assert.ok(family.concepts.includes("grid"));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("React table components cluster together", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-fingerprint-react-"));

  try {
    for (const name of ["users", "profiles", "accounts"]) {
      writeFile(repoRoot, `web/${name}/Table.tsx`, reactTable(`${title(name)}Table`));
    }

    const learning = learnImplementationFingerprints(repoRoot);
    const family = learning.patternFamilies.find((candidate) => candidate.name === "React Table Components");

    assert.ok(family, "Expected React table pattern family");
    assert.equal(family.fileCount, 3);
    assert.ok(family.frameworks.includes("react"));
    assert.ok(family.concepts.includes("table"));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("Spring controllers cluster together", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-fingerprint-spring-"));

  try {
    for (const name of ["User", "Profile", "Account"]) {
      writeFile(repoRoot, `src/main/java/app/${name}Controller.java`, springController(name));
    }

    const learning = learnImplementationFingerprints(repoRoot);
    const family = learning.patternFamilies.find((candidate) => candidate.name === "Spring REST Controllers");

    assert.ok(family, "Expected Spring REST controller pattern family");
    assert.equal(family.fileCount, 3);
    assert.ok(family.frameworks.includes("spring"));
    assert.ok(family.roles.includes("controller"));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("Rust command files cluster together", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-fingerprint-rust-"));

  try {
    for (const name of ["diff", "bundle", "log"]) {
      writeFile(repoRoot, `src/commands/${name}.rs`, rustCommand(title(name)));
    }

    const learning = learnImplementationFingerprints(repoRoot);
    const family = learning.patternFamilies.find((candidate) => candidate.name === "Rust CLI Commands");

    assert.ok(family, "Expected Rust CLI command pattern family");
    assert.equal(family.fileCount, 3);
    assert.ok(family.frameworks.includes("rust"));
    assert.ok(family.libraries.includes("clap"));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("Pattern family can generate a skill even when files never co-change", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-fingerprint-skill-"));

  try {
    const files = ["user", "profile", "account"].map((name) => `src/${name}-grid.component.ts`);
    for (const file of files) {
      writeFile(repoRoot, file, angularKendoGrid(`${title(file.split("/").at(-1) ?? "Grid")}Component`));
    }
    writeFile(repoRoot, "package.json", JSON.stringify({ scripts: { test: "vitest" } }));
    const commits = separateCommits(files, "Add grid screen");
    const fingerprintLearning = learnImplementationFingerprints(repoRoot, commits);
    const mining = minePatterns(scan(repoRoot, commits, fingerprintLearning));
    const familySkill = mining.candidates.find((candidate) => candidate.generatedFrom?.includes("pattern_family"));

    assert.ok(familySkill, "Expected a pattern-family-generated skill");
    assert.equal(familySkill.name, "Add Grid Component");
    assert.equal(familySkill.patternFamily?.name, "Kendo Grid Components");
    assert.equal(familySkill.commonFiles.length >= 3, true);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("explain shows fingerprint evidence", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-fingerprint-explain-"));

  try {
    const files = ["user", "profile", "account"].map((name) => `src/${name}-grid.component.ts`);
    for (const file of files) writeFile(repoRoot, file, angularKendoGrid("GridComponent"));
    const commits = separateCommits(files);
    const fingerprintLearning = learnImplementationFingerprints(repoRoot, commits);
    const mining = minePatterns(scan(repoRoot, commits, fingerprintLearning));
    const familySkill = mining.candidates.find((candidate) => candidate.generatedFrom?.includes("pattern_family"));
    assert.ok(familySkill, "Expected pattern family skill");

    const explanation = generateSkillExplanation(familySkill.id, mining);

    assert.match(explanation, /Fingerprint pattern family:/);
    assert.match(explanation, /Pattern Family: Kendo Grid Components/);
    assert.match(explanation, /Frameworks detected: angular/);
    assert.match(explanation, /Similarity \d+%:/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("pattern family confidence scoring rewards repeated implementation shape", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-fingerprint-confidence-"));

  try {
    for (const name of ["user", "profile", "account"]) {
      writeFile(repoRoot, `src/${name}-grid.component.ts`, angularKendoGrid(`${title(name)}GridComponent`));
    }

    const learning = learnImplementationFingerprints(repoRoot);
    const family = learning.patternFamilies.find((candidate) => candidate.name === "Kendo Grid Components");

    assert.ok(family);
    assert.ok(family.confidence >= 0.9);
    assert.ok(family.similarityScores.every((similarity) => similarity.score >= 0.5));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("framework detection only influences fingerprints, not skill generation", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "compactor-fingerprint-detector-only-"));

  try {
    writeFile(repoRoot, "src/user-grid.component.ts", angularKendoGrid("UserGridComponent"));
    const commits = separateCommits(["src/user-grid.component.ts"]);
    const fingerprintLearning = learnImplementationFingerprints(repoRoot, commits);
    const mining = minePatterns(scan(repoRoot, commits, fingerprintLearning));

    assert.equal(fingerprintLearning.fingerprints[0]?.frameworks.includes("angular"), true);
    assert.equal(fingerprintLearning.patternFamilies.length, 0);
    assert.equal(mining.candidates.some((candidate) => candidate.generatedFrom?.includes("pattern_family")), false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

function scan(repoRoot: string, commits: CommitMetadata[], learning: ReturnType<typeof learnImplementationFingerprints>): ScanResult {
  return {
    repoRoot,
    packageScripts: [],
    validationCommands: [],
    generatedAt: "2026-01-01T00:00:00Z",
    commitsAnalyzed: commits.length,
    commits,
    repeatedPathPatterns: collectRepeatedPathPatterns(commits),
    fingerprints: learning.fingerprints,
    patternFamilies: learning.patternFamilies
  };
}

function separateCommits(files: string[], message = "Add implementation"): CommitMetadata[] {
  return files.map((file, index) => commit(`${index + 1}`.repeat(16), `${message} ${index + 1}`, [file], diffSignalsForFile(file)));
}

function commit(hash: string, message: string, changedFiles: string[], signals: DiffSignal[]): CommitMetadata {
  return classifyCommit({
    hash,
    date: "2026-01-01T00:00:00Z",
    message,
    diffSummary: signals.length > 0 ? diffSummaryWithSignals(signals) : emptyDiffSummary(),
    changedFiles
  });
}

function diffSignalsForFile(file: string): DiffSignal[] {
  if (file.endsWith(".rs")) return [{ type: "cli_command_changed", value: "--format", filePath: file }];
  if (file.endsWith(".java")) return [{ type: "api_route_changed", value: "/api/example", filePath: file }];
  if (file.endsWith(".tsx") || file.endsWith(".ts")) return [{ type: "function_added", value: "render", filePath: file }];
  return [];
}

function writeFile(repoRoot: string, relativePath: string, contents: string): void {
  const absolutePath = join(repoRoot, relativePath);
  mkdirSync(join(absolutePath, ".."), { recursive: true });
  writeFileSync(absolutePath, contents, "utf8");
}

function angularKendoGrid(className: string): string {
  return `
import { Component, inject, signal } from '@angular/core';
import { GridDataResult, GridModule } from '@progress/kendo-angular-grid';

@Component({
  selector: 'app-${className.toLowerCase()}',
  standalone: true,
  imports: [GridModule],
  template: '<kendo-grid [data]="data" [pageable]="true" [sortable]="true"><kendo-grid-column field="name"></kendo-grid-column></kendo-grid>'
})
export class ${className} {
  data: GridDataResult = { data: [], total: 0 };
  columns = ['name'];
  pageSize = signal(20);
  exportCsv() {}
}
`;
}

function reactTable(name: string): string {
  return `
import React, { useEffect, useState } from 'react';

export function ${name}() {
  const [rows, setRows] = useState([]);
  useEffect(() => setRows([]), []);
  return <table><thead><tr><th>Name</th></tr></thead><tbody>{rows.map((row) => <tr><td>{row.name}</td></tr>)}</tbody></table>;
}
`;
}

function springController(name: string): string {
  return `
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ${name}Controller {
  @GetMapping("/api/${name.toLowerCase()}s")
  public List<String> list${name}s() {
    return List.of();
  }
}
`;
}

function rustCommand(name: string): string {
  return `
use clap::Parser;

#[derive(Parser)]
pub struct ${name}Command {
  #[arg(long)]
  pub format: Option<String>,
}

pub fn run_${name.toLowerCase()}(cmd: ${name}Command) {
  println!("{:?}", cmd.format);
}
`;
}

function title(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
