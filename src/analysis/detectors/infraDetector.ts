import type { GenericSignal } from "../../types.js";

export function detectInfraPathSignals(filePath: string): GenericSignal[] {
  const lower = filePath.toLowerCase();
  const signals = new Set<GenericSignal>();

  if (/(^|\/)\.env|environment|config|settings|\.ya?ml$|\.json$|\.toml$|\.ini$/.test(lower)) signals.add("config_changed");
  if (/(^|\/)\.env|env\./.test(lower)) signals.add("env_changed");
  if (/(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|requirements\.txt|pyproject\.toml|poetry\.lock|pom\.xml|build\.gradle|go\.mod|cargo\.toml|\.csproj)$/.test(lower)) {
    signals.add("package_or_dependency_changed");
    signals.add("config_changed");
  }
  if (/(^|\/)(\.github\/workflows|\.gitlab-ci\.yml|jenkinsfile|circle\.yml|azure-pipelines\.yml)(\/|$|\.yml)/.test(lower)) {
    signals.add("ci_changed");
    signals.add("config_changed");
  }
  if (/(^|\/)(dockerfile|docker-compose\.ya?ml)$|(^|\/).*\.dockerfile$/.test(lower)) {
    signals.add("docker_changed");
    signals.add("deployment_changed");
  }
  if (/\.(tf|tfvars)$|(^|\/)(terraform|infra|infrastructure)(\/|$)/.test(lower)) {
    signals.add("terraform_or_infra_changed");
    signals.add("deployment_changed");
  }
  if (/(^|\/)(k8s|kubernetes|helm|deploy|deployment|manifests)(\/|$)/.test(lower)) {
    signals.add("deployment_changed");
  }

  return [...signals];
}

export function detectInfraFrameworkHints(filePath: string): string[] {
  const lower = filePath.toLowerCase();
  const hints = new Set<string>();
  if (/docker/.test(lower)) hints.add("docker");
  if (/\.github\/workflows/.test(lower)) hints.add("github-actions");
  if (/jenkinsfile/.test(lower)) hints.add("jenkins");
  if (/\.gitlab-ci/.test(lower)) hints.add("gitlab-ci");
  if (/\.(tf|tfvars)$/.test(lower)) hints.add("terraform");
  if (/(k8s|kubernetes|helm)/.test(lower)) hints.add("kubernetes-or-helm");
  return [...hints];
}
