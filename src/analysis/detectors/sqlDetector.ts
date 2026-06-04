import type { GenericSignal } from "../../types.js";

export function detectSqlPathSignals(filePath: string): GenericSignal[] {
  const lower = filePath.toLowerCase();
  const signals = new Set<GenericSignal>();

  if (/(^|\/)(migrations?|db\/migrate|alembic|flyway|liquibase|prisma\/migrations|knex|schema)(\/|$)|\.(sql|prisma)$/.test(lower)) {
    signals.add("db_changed");
  }
  if (/(^|\/)(migrations?|db\/migrate|alembic|flyway|liquibase|prisma\/migrations|knex)(\/|$)/.test(lower)) {
    signals.add("migration_changed");
  }
  if (/schema\.prisma$|schema\.sql$|(^|\/)schema(\/|$)/.test(lower)) {
    signals.add("schema_changed");
  }
  if (/(^|\/)(models?|entities?)(\/|$)|\.(model|entity)\./.test(lower)) {
    signals.add("model_or_entity_changed");
  }
  if (/(^|\/)(seeds?|fixtures?\/seeds?)(\/|$)|seed\.(sql|ts|js|py)$/.test(lower)) {
    signals.add("seed_data_changed");
  }
  if (/(^|\/)(queries?|sql)(\/|$)|query\.(sql|ts|js|py)$/.test(lower)) {
    signals.add("query_changed");
  }

  return [...signals];
}

export function detectSqlFrameworkHints(filePath: string): string[] {
  const lower = filePath.toLowerCase();
  const hints = new Set<string>();
  if (/schema\.prisma$|prisma\/migrations/.test(lower)) hints.add("prisma");
  if (/alembic/.test(lower)) hints.add("alembic");
  if (/flyway/.test(lower)) hints.add("flyway");
  if (/liquibase/.test(lower)) hints.add("liquibase");
  if (/knex/.test(lower)) hints.add("knex");
  if (/db\/migrate/.test(lower)) hints.add("rails-like-migrations");
  return [...hints];
}
