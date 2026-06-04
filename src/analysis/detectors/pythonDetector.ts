import type { GenericSignal } from "../../types.js";

export function detectPythonPathSignals(filePath: string): GenericSignal[] {
  const lower = filePath.toLowerCase();
  const signals = new Set<GenericSignal>();

  if (!lower.endsWith(".py")) {
    return [];
  }

  if (/(^|\/)(api|views|routes|routers|controllers|middleware|services)(\/|$)/.test(lower)) signals.add("backend_changed");
  if (/(^|\/)(views|routes|routers)(\/|$)/.test(lower)) signals.add("api_route_changed");
  if (/(^|\/)(services?)(\/|$)|service\.py$/.test(lower)) signals.add("service_layer_changed");
  if (/(^|\/)(repositories?|dao|daos)(\/|$)|repository\.py$|dao\.py$/.test(lower)) signals.add("repository_or_dao_changed");
  if (/(^|\/)(middleware)(\/|$)/.test(lower)) signals.add("middleware_changed");
  if (/(^|\/)(auth|authentication|authorization)(\/|$)/.test(lower)) signals.add("auth_changed");
  if (/(^|\/)(validators?|validation|schemas?|serializers?)(\/|$)/.test(lower)) signals.add("validation_changed");
  if (/(^|\/)(serializers?|schemas?)(\/|$)/.test(lower)) signals.add("serialization_changed");
  if (/(^|\/)(models?|entities?)(\/|$)|models\.py$/.test(lower)) {
    signals.add("db_changed");
    signals.add("model_or_entity_changed");
  }
  if (/(^|\/)(jobs?|workers?|tasks?)(\/|$)/.test(lower)) signals.add("background_job_changed");
  if (/(^|\/)(queues?|events?|handlers?|consumers?)(\/|$)/.test(lower)) signals.add("queue_or_event_handler_changed");

  return [...signals];
}

export function detectPythonFrameworkHints(filePath: string): string[] {
  const lower = filePath.toLowerCase();
  const hints = new Set<string>();
  if (/(^|\/)manage\.py$|(^|\/)settings\.py$|models\.py$|views\.py$/.test(lower)) hints.add("django");
  if (/(^|\/)(routers?|api)(\/|$)/.test(lower)) hints.add("fastapi-or-flask");
  if (/(^|\/)alembic(\/|$)/.test(lower)) hints.add("alembic");
  return [...hints];
}
