import { posix as path } from "node:path";
import { detectDotnetFrameworkHints, detectDotnetPathSignals } from "./detectors/dotnetDetector.js";
import { detectInfraFrameworkHints, detectInfraPathSignals } from "./detectors/infraDetector.js";
import { detectJavaKotlinFrameworkHints, detectJavaKotlinPathSignals } from "./detectors/javaKotlinDetector.js";
import { detectPythonFrameworkHints, detectPythonPathSignals } from "./detectors/pythonDetector.js";
import { detectSqlFrameworkHints, detectSqlPathSignals } from "./detectors/sqlDetector.js";
import { detectTestAndDocsPathSignals } from "./detectors/testDocsDetector.js";
import { detectTypeScriptFrameworkHints, detectTypeScriptPathSignals } from "./detectors/typescriptDetector.js";
import type { DiffSignal, GenericSignal, RawCommit } from "../types.js";

export interface CommitSignalSummary {
  pathSignals: GenericSignal[];
  diffSignals: GenericSignal[];
  genericSignals: GenericSignal[];
  frameworkHints: string[];
  filenameTerms: string[];
  messageTerms: string[];
}

const STOP_TERMS = new Set([
  "add",
  "added",
  "adds",
  "update",
  "updated",
  "updates",
  "fix",
  "fixed",
  "improve",
  "improved",
  "refactor",
  "change",
  "changes",
  "support",
  "with",
  "from",
  "into",
  "the",
  "and",
  "for",
  "use",
  "using"
]);

export function summarizeCommitSignals(commit: RawCommit): CommitSignalSummary {
  const pathSignals = unique(commit.changedFiles.flatMap(extractPathSignals));
  const diffSignals = unique([
    ...commit.diffSummary.signals.map((signal) => signal.type),
    ...commit.diffSummary.signals.flatMap(enrichDiffSignal),
    ...commit.diffSummary.files.flatMap((file) => extractPathSignals(file.filePath))
  ]);

  return {
    pathSignals,
    diffSignals,
    genericSignals: unique([...pathSignals, ...diffSignals]),
    frameworkHints: unique(commit.changedFiles.flatMap(extractFrameworkHints)),
    filenameTerms: topTerms(commit.changedFiles.flatMap(filenameTerms), 8),
    messageTerms: topTerms(tokenize(commit.message), 8)
  };
}

export function extractPathSignals(filePath: string): GenericSignal[] {
  return unique([
    ...detectTypeScriptPathSignals(filePath),
    ...detectPythonPathSignals(filePath),
    ...detectJavaKotlinPathSignals(filePath),
    ...detectDotnetPathSignals(filePath),
    ...detectSqlPathSignals(filePath),
    ...detectInfraPathSignals(filePath),
    ...detectTestAndDocsPathSignals(filePath)
  ]);
}

export function extractFrameworkHints(filePath: string): string[] {
  return unique([
    ...detectTypeScriptFrameworkHints(filePath),
    ...detectPythonFrameworkHints(filePath),
    ...detectJavaKotlinFrameworkHints(filePath),
    ...detectDotnetFrameworkHints(filePath),
    ...detectSqlFrameworkHints(filePath),
    ...detectInfraFrameworkHints(filePath)
  ]);
}

function enrichDiffSignal(signal: DiffSignal): GenericSignal[] {
  const value = signal.value.toLowerCase();
  const filePath = signal.filePath.toLowerCase();
  const signals = new Set<GenericSignal>();

  if (/(controller|resource|endpoint)/.test(value)) signals.add("controller_changed");
  if (/service/.test(value)) signals.add("service_layer_changed");
  if (/(repository|dao)/.test(value)) signals.add("repository_or_dao_changed");
  if (/(middleware|filter|interceptor)/.test(value)) signals.add("middleware_changed");
  if (/(auth|permission|identity|security)/.test(value)) signals.add("auth_changed");
  if (/(validat|schema)/.test(value)) signals.add("validation_changed");
  if (/(serializer|serialize|mapper|dto)/.test(value)) signals.add("serialization_changed");
  if (/(job|worker|task|schedule)/.test(value)) signals.add("background_job_changed");
  if (/(queue|event|handler|consumer|subscriber|listener)/.test(value)) signals.add("queue_or_event_handler_changed");
  if (/(model|entity)/.test(value) || /(^|\/)(models?|entities?)(\/|$)/.test(filePath)) {
    signals.add("db_changed");
    signals.add("model_or_entity_changed");
  }
  if (signal.type === "api_route_changed" || signal.type === "controller_changed") signals.add("backend_changed");
  if (signal.type === "schema_changed" || signal.type === "index_changed" || signal.type === "query_changed") signals.add("db_changed");
  if (signal.type === "test_case_added") {
    if (/(e2e|playwright|cypress)/.test(filePath)) signals.add("e2e_test_changed");
    else if (/integration/.test(filePath)) signals.add("integration_test_changed");
    else signals.add("unit_test_changed");
  }

  return [...signals];
}

function filenameTerms(filePath: string): string[] {
  const base = path.basename(filePath).replace(/\.[^.]+$/, "");
  return tokenize(base);
}

function tokenize(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3 && !STOP_TERMS.has(term));
}

function topTerms(values: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}
