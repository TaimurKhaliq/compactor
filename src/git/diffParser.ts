import { posix as path } from "node:path";
import type { DiffSignal, DiffSummary, FileChangeStatus, FileDiffSummary } from "../types.js";

interface PatchLine {
  kind: "added" | "deleted" | "context";
  text: string;
}

interface MutableFileDiff {
  filePath: string;
  oldPath?: string;
  status: FileChangeStatus;
  addedLineCount: number;
  deletedLineCount: number;
  patchLines: PatchLine[];
}

const EXPORT_PATTERN = /\bexport\s+(?:async\s+)?(?:abstract\s+)?(function|class|interface|type)\s+([A-Za-z_$][\w$]*)/;
const TEST_NAME_PATTERN = /\b(?:describe|it|test)(?:\.(?:only|skip|todo))?\s*\(\s*(['"`])([^'"`]+)\1/g;
const CLI_COMMAND_PATTERN = /\.(?:command|commandDir)\s*\(\s*(['"`])([^'"`\s)]+)\1|\bcommand\s*:\s*(['"`])([^'"`]+)\3/g;
const CLI_OPTION_PATTERN = /\.(?:option|requiredOption)\s*\(\s*(['"`])([^'"`]*--[A-Za-z0-9][\w-]*)[^'"`]*\1|(?:^|\s)(--[A-Za-z0-9][\w-]*)\b/g;
const CONFIG_KEY_PATTERN = /^\s*["']?([A-Za-z_][\w.-]*)["']?\s*[:=]/;
const ROUTE_PATTERN =
  /\b(?:app|router|server)\s*\.\s*(get|post|put|patch|delete|use|all)\s*\(\s*(['"`])([^'"`]+)\2|\b(?:route|handler)\s*\(\s*(['"`])([^'"`]+)\4|\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/i;
const CONTROLLER_HANDLER_PATTERN = /\b(?:export\s+)?(?:async\s+)?(?:function|class|const)\s+([A-Za-z_$][\w$]*(?:Controller|Handler|Route))\b/;

export function parseUnifiedDiff(diff: string): DiffSummary {
  const files: FileDiffSummary[] = [];
  let current: MutableFileDiff | undefined;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current) {
        files.push(finalizeFileDiff(current));
      }
      current = createFileDiff(line);
      continue;
    }

    if (!current) {
      continue;
    }

    applyFileHeaderLine(current, line);

    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }

    if (line.startsWith("+")) {
      current.addedLineCount += 1;
      current.patchLines.push({ kind: "added", text: line.slice(1) });
      continue;
    }

    if (line.startsWith("-")) {
      current.deletedLineCount += 1;
      current.patchLines.push({ kind: "deleted", text: line.slice(1) });
      continue;
    }

    if (line.startsWith(" ")) {
      current.patchLines.push({ kind: "context", text: line.slice(1) });
    }
  }

  if (current) {
    files.push(finalizeFileDiff(current));
  }

  const signals = files.flatMap((file) => file.signals);

  return {
    files,
    totalAddedLines: files.reduce((sum, file) => sum + file.addedLineCount, 0),
    totalDeletedLines: files.reduce((sum, file) => sum + file.deletedLineCount, 0),
    signals
  };
}

export function extractTestNames(lines: string[]): string[] {
  return uniqueSorted(lines.flatMap((line) => collectRegexGroup(line, TEST_NAME_PATTERN, 2)));
}

function createFileDiff(diffHeader: string): MutableFileDiff {
  const match = /^diff --git (.+) (.+)$/.exec(diffHeader);
  const oldPath = match?.[1] ? stripGitPrefix(match[1]) : "unknown";
  const filePath = match?.[2] ? stripGitPrefix(match[2]) : oldPath;

  return {
    filePath,
    oldPath,
    status: "modified",
    addedLineCount: 0,
    deletedLineCount: 0,
    patchLines: []
  };
}

function applyFileHeaderLine(file: MutableFileDiff, line: string): void {
  if (line.startsWith("new file mode")) {
    file.status = "added";
    return;
  }

  if (line.startsWith("deleted file mode")) {
    file.status = "deleted";
    return;
  }

  if (line.startsWith("rename from ")) {
    file.status = "renamed";
    file.oldPath = line.slice("rename from ".length).trim();
    return;
  }

  if (line.startsWith("rename to ")) {
    file.status = "renamed";
    file.filePath = line.slice("rename to ".length).trim();
    return;
  }

  if (line.startsWith("+++ ")) {
    const newPath = stripDiffPath(line.slice(4).trim());
    if (newPath !== "/dev/null") {
      file.filePath = newPath;
    }
    return;
  }

  if (line.startsWith("--- ")) {
    const oldPath = stripDiffPath(line.slice(4).trim());
    if (oldPath !== "/dev/null") {
      file.oldPath = oldPath;
      if (file.filePath === "/dev/null") {
        file.filePath = oldPath;
      }
    }
  }
}

function finalizeFileDiff(file: MutableFileDiff): FileDiffSummary {
  const addedLines = file.patchLines.filter((line) => line.kind === "added").map((line) => line.text);
  const addedExports = extractAddedExports(addedLines);
  const addedTestNames = extractTestNames(addedLines);
  const addedCliCommands = extractCliCommands(file.filePath, addedLines);
  const addedCliOptions = extractCliOptions(file.filePath, addedLines);
  const changedPackageScripts = extractChangedPackageScripts(file.filePath, file.patchLines);
  const addedConfigKeys = extractConfigKeys(file.filePath, addedLines);
  const addedRoutes = extractRoutes(addedLines);
  const signals = buildSignals(file.filePath, {
    addedExports,
    addedTestNames,
    addedCliCommands,
    addedCliOptions,
    changedPackageScripts,
    addedConfigKeys,
    addedRoutes
  });

  return {
    filePath: file.filePath,
    oldPath: file.oldPath === file.filePath ? undefined : file.oldPath,
    status: file.status,
    addedLineCount: file.addedLineCount,
    deletedLineCount: file.deletedLineCount,
    addedExports,
    addedTestNames,
    addedCliCommands,
    addedCliOptions,
    changedPackageScripts,
    addedConfigKeys,
    addedRoutes,
    signals
  };
}

function extractAddedExports(lines: string[]): string[] {
  return uniqueSorted(
    lines.flatMap((line) => {
      const match = EXPORT_PATTERN.exec(line);
      if (!match?.[1] || !match?.[2]) {
        return [];
      }
      return `${match[1]} ${match[2]}`;
    })
  );
}

function extractCliCommands(filePath: string, lines: string[]): string[] {
  if (!isCliFile(filePath)) {
    return [];
  }

  return uniqueSorted(
    lines.flatMap((line) => [
      ...collectRegexAlternatives(line, CLI_COMMAND_PATTERN, [2, 4]),
      ...collectSwitchCommands(line)
    ])
  );
}

function extractCliOptions(filePath: string, lines: string[]): string[] {
  if (!isCliFile(filePath)) {
    return [];
  }

  return uniqueSorted(lines.flatMap((line) => collectRegexAlternatives(line, CLI_OPTION_PATTERN, [2, 3])));
}

function extractChangedPackageScripts(filePath: string, lines: PatchLine[]): string[] {
  if (path.basename(filePath) !== "package.json") {
    return [];
  }

  const changedScripts = new Set<string>();
  lines.forEach((line, index) => {
    if (line.kind !== "added") {
      return;
    }

    const match = /^\s*"([^"]+)":\s*"[^"]*"/.exec(line.text);
    if (!match?.[1]) {
      return;
    }

    const nearbyLines = lines.slice(Math.max(0, index - 8), Math.min(lines.length, index + 2));
    if (nearbyLines.some((nearby) => /"scripts"\s*:/.test(nearby.text))) {
      changedScripts.add(match[1]);
    }
  });

  return [...changedScripts].sort();
}

function extractConfigKeys(filePath: string, lines: string[]): string[] {
  if (!isConfigFile(filePath)) {
    return [];
  }

  return uniqueSorted(
    lines.flatMap((line) => {
      const match = CONFIG_KEY_PATTERN.exec(line);
      return match?.[1] ? [match[1]] : [];
    })
  );
}

function extractRoutes(lines: string[]): string[] {
  return uniqueSorted(
    lines.flatMap((line) => {
      const match = ROUTE_PATTERN.exec(line);
      const controllerMatch = CONTROLLER_HANDLER_PATTERN.exec(line);
      const values: string[] = [];

      if (match?.[6]) {
        values.push(`${match[6].toUpperCase()} handler`);
      } else if (match) {
        const method = match[1] || "handler";
        const route = match[3] || match[5] || method;
        values.push(`${method.toUpperCase()} ${route}`);
      }

      if (controllerMatch?.[1]) {
        values.push(`handler ${controllerMatch[1]}`);
      }

      return values;
    })
  );
}

function buildSignals(
  filePath: string,
  values: Pick<
    FileDiffSummary,
    | "addedExports"
    | "addedTestNames"
    | "addedCliCommands"
    | "addedCliOptions"
    | "changedPackageScripts"
    | "addedConfigKeys"
    | "addedRoutes"
  >
): DiffSignal[] {
  return [
    ...values.addedExports.map((value) => signal("exported-symbol", value, filePath)),
    ...values.addedTestNames.map((value) => signal("test-name", value, filePath)),
    ...values.addedCliCommands.map((value) => signal("cli-command", value, filePath)),
    ...values.addedCliOptions.map((value) => signal("cli-option", value, filePath)),
    ...values.changedPackageScripts.map((value) => signal("package-script", value, filePath)),
    ...values.addedConfigKeys.map((value) => signal("config-key", value, filePath)),
    ...values.addedRoutes.map((value) => signal(isHandlerRouteValue(value) ? "route-handler" : "api-route", value, filePath))
  ];
}

function signal(type: DiffSignal["type"], value: string, filePath: string): DiffSignal {
  return { type, value, filePath };
}

function isHandlerRouteValue(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.endsWith(" handler") || lower.startsWith("handler ") || lower.includes("controller");
}

function collectSwitchCommands(line: string): string[] {
  const match = /^\s*case\s+['"`]([a-z0-9][\w:-]*)['"`]\s*:/.exec(line);
  return match?.[1] ? [match[1]] : [];
}

function collectRegexGroup(line: string, pattern: RegExp, group: number): string[] {
  pattern.lastIndex = 0;
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) {
    const value = match[group];
    if (value) {
      values.push(value);
    }
  }
  return values;
}

function collectRegexAlternatives(line: string, pattern: RegExp, groups: number[]): string[] {
  pattern.lastIndex = 0;
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) {
    for (const group of groups) {
      const value = match[group];
      if (value) {
        values.push(value.trim());
        break;
      }
    }
  }
  return values;
}

function stripGitPrefix(value: string): string {
  return stripDiffPath(value.replace(/^"|"$/g, ""));
}

function stripDiffPath(value: string): string {
  return value.replace(/^a\//, "").replace(/^b\//, "");
}

function isCliFile(filePath: string): boolean {
  return /(^|\/)(cli|commands?)(\/|$)|(^|\/)bin(\/|$)|cli\.[jt]sx?$/i.test(filePath);
}

function isConfigFile(filePath: string): boolean {
  return /(^|\/)\.env|environment|config|\.json$|\.ya?ml$|\.toml$|\.ini$/i.test(filePath);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}
