import { readFileSync } from "node:fs";
import { join } from "node:path";

const PREFERRED_VALIDATION_SCRIPTS = ["test", "build", "typecheck", "lint", "e2e", "ui:test"];

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
