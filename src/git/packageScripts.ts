import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const PREFERRED_VALIDATION_SCRIPTS = ["test", "build", "typecheck", "lint", "e2e", "ui:test"];
const PREFERRED_MAKE_TARGETS = ["test", "build", "typecheck", "lint", "e2e"];

export function readPackageScripts(repoRoot: string): string[] {
  try {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };

    return Object.entries(packageJson.scripts ?? {})
      .filter(([, value]) => typeof value === "string")
      .map(([name]) => name)
      .sort();
  } catch {
    return [];
  }
}

export function preferredValidationCommands(packageScripts: string[]): string[] {
  const available = new Set(packageScripts);
  return PREFERRED_VALIDATION_SCRIPTS.filter((script) => available.has(script)).map((script) =>
    script === "test" ? "npm test" : `npm run ${script}`
  );
}

export function discoverValidationCommands(repoRoot: string): string[] {
  return unique([
    ...preferredValidationCommands(readPackageScripts(repoRoot)),
    ...discoverMakeTargets(repoRoot),
    ...discoverJvmCommands(repoRoot),
    ...discoverPythonCommands(repoRoot),
    ...discoverGoCommands(repoRoot),
    ...discoverDotnetCommands(repoRoot),
    ...discoverRustCommands(repoRoot),
    ...discoverSimpleCiCommands(repoRoot)
  ]);
}

export function discoverValidationCommandsForFiles(repoRoot: string, filePaths: string[]): string[] {
  const projectRoots = rankedProjectRoots(repoRoot, filePaths);
  if (projectRoots.length === 0) {
    return [];
  }

  return unique(projectRoots.flatMap((projectRoot) => discoverValidationCommandsForProject(repoRoot, projectRoot)));
}

function rankedProjectRoots(repoRoot: string, filePaths: string[]): string[] {
  const counts = new Map<string, number>();
  for (const filePath of filePaths) {
    const projectRoot = nearestProjectRoot(repoRoot, filePath);
    if (!projectRoot) {
      continue;
    }
    counts.set(projectRoot, (counts.get(projectRoot) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([projectRoot]) => projectRoot);
}

function nearestProjectRoot(repoRoot: string, filePath: string): string | undefined {
  let current = join(repoRoot, dirname(filePath));
  while (current.startsWith(repoRoot)) {
    if (hasProjectFile(current)) {
      return current;
    }
    const next = dirname(current);
    if (next === current) {
      break;
    }
    current = next;
  }
  return hasProjectFile(repoRoot) ? repoRoot : undefined;
}

function hasProjectFile(projectRoot: string): boolean {
  return [
    "package.json",
    "pyproject.toml",
    "pytest.ini",
    "tox.ini",
    "Makefile",
    "makefile",
    "go.mod",
    "Cargo.toml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts"
  ].some((name) => existsSync(join(projectRoot, name))) || readdirSafe(projectRoot).some((name) => name.endsWith(".sln") || name.endsWith(".csproj"));
}

function discoverValidationCommandsForProject(repoRoot: string, projectRoot: string): string[] {
  return unique([
    ...preferredValidationCommandsForProject(repoRoot, projectRoot, readPackageScripts(projectRoot)),
    ...discoverMakeTargets(projectRoot),
    ...discoverJvmCommands(projectRoot),
    ...discoverPythonCommands(projectRoot),
    ...discoverGoCommands(projectRoot),
    ...discoverDotnetCommands(projectRoot),
    ...discoverRustCommands(projectRoot)
  ]);
}

function preferredValidationCommandsForProject(repoRoot: string, projectRoot: string, packageScripts: string[]): string[] {
  const available = new Set(packageScripts);
  const prefix = npmPrefix(repoRoot, projectRoot);
  return PREFERRED_VALIDATION_SCRIPTS.filter((script) => available.has(script)).map((script) => {
    if (script === "test") {
      return prefix ? `npm --prefix ${prefix} test` : "npm test";
    }
    return prefix ? `npm --prefix ${prefix} run ${script}` : `npm run ${script}`;
  });
}

function npmPrefix(repoRoot: string, projectRoot: string): string {
  const rel = relative(repoRoot, projectRoot).replace(/\\/g, "/");
  return rel === "." || rel === "" ? "" : rel;
}

function discoverMakeTargets(repoRoot: string): string[] {
  const makefile = ["Makefile", "makefile"].find((name) => existsSync(join(repoRoot, name)));
  if (!makefile) {
    return [];
  }

  const content = readFileSync(join(repoRoot, makefile), "utf8");
  const targets = new Set(
    content
      .split("\n")
      .map((line) => /^([A-Za-z0-9_.:-]+):(?:\s|$)/.exec(line)?.[1])
      .filter((target): target is string => Boolean(target))
  );

  return PREFERRED_MAKE_TARGETS.filter((target) => targets.has(target)).map((target) => `make ${target}`);
}

function discoverJvmCommands(repoRoot: string): string[] {
  const commands: string[] = [];
  if (existsSync(join(repoRoot, "pom.xml"))) {
    commands.push("mvn test");
  }
  if (existsSync(join(repoRoot, "build.gradle")) || existsSync(join(repoRoot, "build.gradle.kts"))) {
    commands.push(existsSync(join(repoRoot, "gradlew")) ? "./gradlew test" : "gradle test");
  }
  return commands;
}

function discoverPythonCommands(repoRoot: string): string[] {
  const hasPyProject = existsSync(join(repoRoot, "pyproject.toml"));
  const hasPytestConfig = ["pytest.ini", "tox.ini", "setup.cfg"].some((name) => {
    const file = join(repoRoot, name);
    return existsSync(file) && /pytest/i.test(readFileSync(file, "utf8"));
  });
  const hasTests = existsSync(join(repoRoot, "tests"));

  if (hasPytestConfig || (hasPyProject && hasTests)) {
    return ["pytest"];
  }

  if (hasTests && hasAnyFileWithExtension(join(repoRoot, "tests"), ".py")) {
    return ["python -m unittest"];
  }

  return [];
}

function discoverGoCommands(repoRoot: string): string[] {
  return existsSync(join(repoRoot, "go.mod")) ? ["go test ./..."] : [];
}

function discoverDotnetCommands(repoRoot: string): string[] {
  return readdirSafe(repoRoot).some((name) => name.endsWith(".sln") || name.endsWith(".csproj")) ? ["dotnet test"] : [];
}

function discoverRustCommands(repoRoot: string): string[] {
  return existsSync(join(repoRoot, "Cargo.toml")) ? ["cargo test"] : [];
}

function discoverSimpleCiCommands(repoRoot: string): string[] {
  const workflowDir = join(repoRoot, ".github", "workflows");
  const commands = new Set<string>();
  for (const name of readdirSafe(workflowDir)) {
    if (!/\.ya?ml$/i.test(name)) {
      continue;
    }
    const content = readFileSync(join(workflowDir, name), "utf8");
    for (const line of content.split("\n")) {
      const command = /^\s*run:\s*(npm test|npm run [\w:-]+|pytest|go test \.\/\.\.\.|dotnet test|cargo test|mvn test|\.\/gradlew test|gradle test)\s*$/.exec(line)?.[1];
      if (command) {
        commands.add(command);
      }
    }
  }
  return [...commands];
}

function hasAnyFileWithExtension(dir: string, extension: string): boolean {
  for (const entry of readdirSafe(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(extension)) return true;
    if (entry.isDirectory() && hasAnyFileWithExtension(fullPath, extension)) return true;
  }
  return false;
}

function readdirSafe(path: string, options?: { withFileTypes?: false }): string[];
function readdirSafe(path: string, options: { withFileTypes: true }): import("node:fs").Dirent[];
function readdirSafe(path: string, options?: { withFileTypes?: boolean }): string[] | import("node:fs").Dirent[] {
  try {
    return readdirSync(path, options as never);
  } catch {
    return [];
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
