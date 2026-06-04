import type { GenericSignal } from "../../types.js";

export function detectTypeScriptPathSignals(filePath: string): GenericSignal[] {
  const lower = filePath.toLowerCase();
  const signals = new Set<GenericSignal>();

  if (/\.(tsx|jsx|html|css|scss|sass|less|vue|svelte)$/.test(lower) || /(^|\/)(ui|web|client|frontend|components|pages|screens|views)(\/|$)/.test(lower)) {
    signals.add("ui_changed");
  }
  if (/(^|\/)(components?|widgets?)(\/|$)|\.component\.(ts|tsx|html|css|scss)$|component\.(ts|tsx)$/.test(lower)) {
    signals.add("component_changed");
  }
  if (/(^|\/)(pages?|screens?|views?)(\/|$)/.test(lower)) {
    signals.add("page_or_screen_changed");
  }
  if (/(^|\/)(routes?|router|routing)(\/|$)|routes?\.(ts|tsx|js|jsx)$/.test(lower)) {
    signals.add("route_view_changed");
  }
  if (/\.(css|scss|sass|less)$/.test(lower)) {
    signals.add("style_changed");
  }
  if (/(^|\/)(api|server|backend|controllers?|routes?|middleware|services?)(\/|$)|\.(controller|resolver|route|middleware|service)\.[jt]s$/.test(lower)) {
    signals.add("backend_changed");
  }
  if (/(^|\/)(controllers?)(\/|$)|\.controller\.[jt]s$/.test(lower)) {
    signals.add("controller_changed");
  }
  if (/(^|\/)(services?)(\/|$)|\.service\.[jt]s$/.test(lower)) {
    signals.add("service_layer_changed");
  }
  if (/(^|\/)(repositories?|dao|daos)(\/|$)|\.(repository|repo|dao)\.[jt]s$/.test(lower)) {
    signals.add("repository_or_dao_changed");
  }
  if (/(^|\/)middleware(\/|$)|\.middleware\.[jt]s$/.test(lower)) {
    signals.add("middleware_changed");
  }
  if (/(^|\/)(auth|authentication|authorization)(\/|$)|auth\.[jt]s$/.test(lower)) {
    signals.add("auth_changed");
  }
  if (/(^|\/)(validators?|validation|schemas?)(\/|$)|\.(validator|schema|zod)\.[jt]s$/.test(lower)) {
    signals.add("validation_changed");
  }
  if (/(^|\/)(serializers?|dto|dtos|mappers?)(\/|$)|\.(serializer|dto|mapper)\.[jt]s$/.test(lower)) {
    signals.add("serialization_changed");
  }
  if (/(^|\/)(jobs?|workers?|tasks?)(\/|$)|\.(job|worker|task)\.[jt]s$/.test(lower)) {
    signals.add("background_job_changed");
  }
  if (/(^|\/)(queues?|events?|handlers?|consumers?|subscribers?)(\/|$)|\.(handler|consumer|subscriber|event)\.[jt]s$/.test(lower)) {
    signals.add("queue_or_event_handler_changed");
  }
  if (/(^|\/)(models?|entities?)(\/|$)|\.(model|entity)\.[jt]s$|schema\.prisma$/.test(lower)) {
    signals.add("model_or_entity_changed");
    signals.add("db_changed");
  }

  return [...signals];
}

export function detectTypeScriptFrameworkHints(filePath: string): string[] {
  const lower = filePath.toLowerCase();
  const hints = new Set<string>();

  if (/schema\.prisma$/.test(lower)) hints.add("prisma");
  if (/nest|\.controller\.ts$|\.module\.ts$/.test(lower)) hints.add("nestjs");
  if (/angular\.json$|\.component\.ts$/.test(lower)) hints.add("angular");
  if (/\.(tsx|jsx)$/.test(lower)) hints.add("react-like");
  if (/next\.config|(^|\/)app\/.*page\.(tsx|jsx|ts|js)$/.test(lower)) hints.add("nextjs");

  return [...hints];
}
