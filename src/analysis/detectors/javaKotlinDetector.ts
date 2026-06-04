import type { GenericSignal } from "../../types.js";

export function detectJavaKotlinPathSignals(filePath: string): GenericSignal[] {
  const lower = filePath.toLowerCase();
  if (!/\.(java|kt|kts)$/.test(lower)) return [];

  const signals = new Set<GenericSignal>();
  if (/(controller|resource|endpoint)/.test(lower)) {
    signals.add("backend_changed");
    signals.add("controller_changed");
  }
  if (/service/.test(lower)) signals.add("service_layer_changed");
  if (/(repository|dao)/.test(lower)) signals.add("repository_or_dao_changed");
  if (/(middleware|filter|interceptor)/.test(lower)) signals.add("middleware_changed");
  if (/(auth|security)/.test(lower)) signals.add("auth_changed");
  if (/(validator|validation)/.test(lower)) signals.add("validation_changed");
  if (/(serializer|mapper|dto)/.test(lower)) signals.add("serialization_changed");
  if (/(entity|model)/.test(lower)) {
    signals.add("db_changed");
    signals.add("model_or_entity_changed");
  }
  if (/(job|worker|task|scheduler)/.test(lower)) signals.add("background_job_changed");
  if (/(event|handler|listener|consumer|subscriber)/.test(lower)) signals.add("queue_or_event_handler_changed");
  if (signals.size > 0) signals.add("backend_changed");
  return [...signals];
}

export function detectJavaKotlinFrameworkHints(filePath: string): string[] {
  const lower = filePath.toLowerCase();
  const hints = new Set<string>();
  if (/\.(java|kt)$/.test(lower) && /(controller|repository|entity|service)/.test(lower)) hints.add("spring-or-jvm");
  if (/build\.gradle|\.gradle\.kts$/.test(lower)) hints.add("gradle");
  if (/pom\.xml$/.test(lower)) hints.add("maven");
  return [...hints];
}
