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

interface SignalBuildValues {
  addedExports: string[];
  addedFunctions: string[];
  addedClasses: string[];
  addedInterfacesOrTypes: string[];
  addedEnums: string[];
  addedTestNames: string[];
  addedCliCommands: string[];
  addedCliOptions: string[];
  changedPackageScripts: string[];
  addedConfigKeys: string[];
  addedRoutes: string[];
  sqlSignals: DiffSignal["type"][];
}

const EXPORT_PATTERN = /\bexport\s+(?:async\s+)?(?:abstract\s+)?(function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const FUNCTION_PATTERN =
  /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b|^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(|\b(?:public|private|protected|internal|static|\s)+[\w<>,\[\]?]+\s+([A-Za-z_]\w*)\s*\(/;
const CLASS_PATTERN = /\b(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b|^\s*class\s+([A-Za-z_]\w*)\b/;
const INTERFACE_OR_TYPE_PATTERN = /\b(?:export\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)\b|\b(?:public\s+)?interface\s+([A-Za-z_]\w*)\b/;
const ENUM_PATTERN = /\b(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)\b|\b(?:public\s+)?enum\s+([A-Za-z_]\w*)\b/;
const TEST_NAME_PATTERN = /\b(?:describe|it|test)(?:\.(?:only|skip|todo))?\s*\(\s*(['"`])([^'"`]+)\1/g;
const CLI_COMMAND_PATTERN = /\.(?:command|commandDir)\s*\(\s*(['"`])([^'"`\s)]+)\1|\bcommand\s*:\s*(['"`])([^'"`]+)\3/g;
const CLI_OPTION_PATTERN = /\.(?:option|requiredOption)\s*\(\s*(['"`])([^'"`]*--[A-Za-z0-9][\w-]*)[^'"`]*\1|(?:^|\s)(--[A-Za-z0-9][\w-]*)\b/g;
const CONFIG_KEY_PATTERN = /^\s*["']?([A-Za-z_][\w.-]*)["']?\s*[:=]/;
const ROUTE_PATTERN =
  /\b(?:app|router|server|fastify)\s*\.\s*(get|post|put|patch|delete|use|all)\s*\(\s*(['"`])([^'"`]+)\2|\b(?:route|handler)\s*\(\s*(['"`])([^'"`]+)\4|\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b|@(app|router|api)\.(get|post|put|patch|delete|route)\s*\(\s*(['"`])([^'"`]+)\9|@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|RequestMapping)\s*(?:\(\s*(?:value\s*=\s*)?["']([^"']+)["'])?|@(HttpGet|HttpPost|HttpPut|HttpPatch|HttpDelete)\s*(?:\(\s*["']([^"']+)["'])?/i;
const CONTROLLER_HANDLER_PATTERN = /\b(?:export\s+)?(?:async\s+)?(?:function|class|const)\s+([A-Za-z_$][\w$]*(?:Controller|Handler|Route))\b/;
const SQL_SCHEMA_PATTERN = /\b(create|alter|drop)\s+table\b/i;
const SQL_INDEX_PATTERN = /\b(create|drop)\s+(?:unique\s+)?index\b/i;
const SQL_QUERY_PATTERN = /\b(select|insert\s+into|update|delete\s+from)\b/i;

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
  const shouldExtractCodeSymbols = isCodeSymbolFile(file.filePath);
  const addedExports = shouldExtractCodeSymbols ? extractAddedExports(addedLines) : [];
  const addedFunctions = shouldExtractCodeSymbols ? extractAddedFunctions(addedLines) : [];
  const addedClasses = shouldExtractCodeSymbols ? extractAddedClasses(addedLines) : [];
  const addedInterfacesOrTypes = shouldExtractCodeSymbols ? extractAddedInterfacesOrTypes(addedLines) : [];
  const addedEnums = shouldExtractCodeSymbols ? extractAddedEnums(addedLines) : [];
  const addedTestNames = extractTestNames(addedLines);
  const addedCliCommands = extractCliCommands(file.filePath, addedLines);
  const addedCliOptions = extractCliOptions(file.filePath, addedLines);
  const changedPackageScripts = extractChangedPackageScripts(file.filePath, file.patchLines);
  const addedConfigKeys = extractConfigKeys(file.filePath, addedLines);
  const addedRoutes = extractRoutes(file.filePath, addedLines);
  const sqlSignals = extractSqlSignals(file.filePath, addedLines);
  const signals = buildSignals(file.filePath, {
    addedExports,
    addedFunctions,
    addedClasses,
    addedInterfacesOrTypes,
    addedEnums,
    addedTestNames,
    addedCliCommands,
    addedCliOptions,
    changedPackageScripts,
    addedConfigKeys,
    addedRoutes,
    sqlSignals
  });

  return {
    filePath: file.filePath,
    oldPath: file.oldPath === file.filePath ? undefined : file.oldPath,
    status: file.status,
    addedLineCount: file.addedLineCount,
    deletedLineCount: file.deletedLineCount,
    addedExports,
    addedFunctions,
    addedClasses,
    addedInterfacesOrTypes,
    addedEnums,
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

function extractAddedFunctions(lines: string[]): string[] {
  return uniqueSorted(lines.flatMap((line) => collectRegexAlternatives(line, FUNCTION_PATTERN, [1, 2, 3])));
}

function extractAddedClasses(lines: string[]): string[] {
  return uniqueSorted(lines.flatMap((line) => collectRegexAlternatives(line, CLASS_PATTERN, [1, 2])));
}

function extractAddedInterfacesOrTypes(lines: string[]): string[] {
  return uniqueSorted(lines.flatMap((line) => collectRegexAlternatives(line, INTERFACE_OR_TYPE_PATTERN, [1, 2])));
}

function extractAddedEnums(lines: string[]): string[] {
  return uniqueSorted(lines.flatMap((line) => collectRegexAlternatives(line, ENUM_PATTERN, [1, 2])));
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

function extractRoutes(filePath: string, lines: string[]): string[] {
  if (isTestFile(filePath) || isFixtureFile(filePath)) {
    return [];
  }

  return uniqueSorted(
    lines.flatMap((line) => {
      const match = ROUTE_PATTERN.exec(line);
      const controllerMatch = CONTROLLER_HANDLER_PATTERN.exec(line);
      const values: string[] = [];

      if (match?.[6]) {
        values.push(`${match[6].toUpperCase()} handler`);
      } else if (match) {
        const annotationMethod = annotationToMethod(match[11] || match[13]);
        const pythonMethod = match[8]?.toUpperCase();
        const method = match[1]?.toUpperCase() || pythonMethod || annotationMethod || "HANDLER";
        const route = match[3] || match[5] || match[10] || match[12] || match[14] || method;
        values.push(`${method.toUpperCase()} ${route}`);
      }

      if (controllerMatch?.[1]) {
        values.push(`handler ${controllerMatch[1]}`);
      }

      return values;
    })
  );
}

function extractSqlSignals(filePath: string, lines: string[]): DiffSignal["type"][] {
  if (!isSqlLikeFile(filePath)) {
    return [];
  }

  return uniqueSorted(
    lines.flatMap((line) => {
      const signals: DiffSignal["type"][] = [];
      if (SQL_SCHEMA_PATTERN.test(line)) signals.push("schema_changed");
      if (SQL_INDEX_PATTERN.test(line)) signals.push("index_changed");
      if (SQL_QUERY_PATTERN.test(line)) signals.push("query_changed");
      return signals;
    })
  ) as DiffSignal["type"][];
}

function buildSignals(filePath: string, values: SignalBuildValues): DiffSignal[] {
  return [
    ...values.addedExports.map((value) => signal("exported_symbol_added", value, filePath)),
    ...values.addedFunctions.map((value) => signal("function_added", value, filePath)),
    ...values.addedClasses.map((value) => signal(classSignalType(value), value, filePath)),
    ...values.addedInterfacesOrTypes.map((value) => signal("interface_or_type_added", value, filePath)),
    ...values.addedEnums.map((value) => signal("enum_added", value, filePath)),
    ...values.addedTestNames.map((value) => signal("test_case_added", value, filePath)),
    ...values.addedCliCommands.map((value) => signal("cli_command_changed", value, filePath)),
    ...values.addedCliOptions.map((value) => signal("cli_command_changed", value, filePath)),
    ...values.changedPackageScripts.map((value) => signal("package_script_changed", value, filePath)),
    ...values.addedConfigKeys.map((value) => signal("config_changed", value, filePath)),
    ...values.addedRoutes.map((value) => signal(isHandlerRouteValue(value) ? "controller_changed" : "api_route_changed", value, filePath)),
    ...values.sqlSignals.map((value) => signal(value, value.replace(/_/g, " "), filePath))
  ];
}

function signal(type: DiffSignal["type"], value: string, filePath: string): DiffSignal {
  return { type, value, filePath };
}

function isHandlerRouteValue(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.endsWith(" handler") || lower.startsWith("handler ") || lower.includes("controller");
}

function classSignalType(value: string): DiffSignal["type"] {
  return /(controller)$/i.test(value) ? "controller_changed" : "class_added";
}

function annotationToMethod(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const lower = value.toLowerCase();
  if (lower.includes("post")) return "POST";
  if (lower.includes("put")) return "PUT";
  if (lower.includes("patch")) return "PATCH";
  if (lower.includes("delete")) return "DELETE";
  if (lower.includes("get")) return "GET";
  return "ROUTE";
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
  if (!pattern.global) {
    const match = pattern.exec(line);
    if (!match) {
      return values;
    }
    for (const group of groups) {
      const value = match[group];
      if (value) {
        values.push(value.trim());
        break;
      }
    }
    return values;
  }

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

function isSqlLikeFile(filePath: string): boolean {
  return /\.(sql|prisma)$/i.test(filePath) || /(^|\/)(migrations?|db|database|schema)(\/|$)/i.test(filePath);
}

function isTestFile(filePath: string): boolean {
  return /(\.spec\.|\.(test|tests)\.)|(^|\/)__tests__(\/|$)|(^|\/)tests?(\/|$)/i.test(filePath);
}

function isFixtureFile(filePath: string): boolean {
  return /(^|\/)(fixtures?|testdata|test-data|__fixtures__)(\/|$)/i.test(filePath);
}

function isCodeSymbolFile(filePath: string): boolean {
  return /\.(tsx?|jsx?|py|java|kt|cs)$/i.test(filePath);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}
