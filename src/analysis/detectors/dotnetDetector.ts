import type { GenericSignal } from "../../types.js";

export function detectDotnetPathSignals(filePath: string): GenericSignal[] {
  const lower = filePath.toLowerCase();
  if (!/\.(cs|csproj|sln)$/.test(lower)) return [];

  const signals = new Set<GenericSignal>();
  if (/(controller|endpoint)/.test(lower)) {
    signals.add("backend_changed");
    signals.add("controller_changed");
  }
  if (/service/.test(lower)) signals.add("service_layer_changed");
  if (/(repository|dao)/.test(lower)) signals.add("repository_or_dao_changed");
  if (/(middleware|filter)/.test(lower)) signals.add("middleware_changed");
  if (/(auth|identity|security)/.test(lower)) signals.add("auth_changed");
  if (/(validator|validation)/.test(lower)) signals.add("validation_changed");
  if (/(serializer|mapper|dto)/.test(lower)) signals.add("serialization_changed");
  if (/(entity|model)/.test(lower)) {
    signals.add("db_changed");
    signals.add("model_or_entity_changed");
  }
  if (/(job|worker|task|backgroundservice)/.test(lower)) signals.add("background_job_changed");
  if (/(event|handler|consumer|subscriber)/.test(lower)) signals.add("queue_or_event_handler_changed");
  if (lower.endsWith(".csproj") || lower.endsWith(".sln")) signals.add("config_changed");
  return [...signals];
}

export function detectDotnetFrameworkHints(filePath: string): string[] {
  return /\.(cs|csproj|sln)$/i.test(filePath) ? ["dotnet"] : [];
}
