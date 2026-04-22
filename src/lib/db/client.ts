import postgres from "postgres";

import { getAppConfig } from "@/lib/config";
import { DATABASE_SCHEMA_SQL } from "@/lib/db/schema";

let dbClient: postgres.Sql | null = null;
let schemaEnsured = false;

export function getDb() {
  if (dbClient) {
    return dbClient;
  }

  const { databaseUrl } = getAppConfig();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  dbClient = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
  });

  return dbClient;
}

export async function ensureDatabaseSchema() {
  if (schemaEnsured) {
    return;
  }

  const db = getDb();
  await db.unsafe(DATABASE_SCHEMA_SQL);
  schemaEnsured = true;
}
