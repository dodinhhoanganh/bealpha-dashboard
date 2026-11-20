import { writeFile } from "node:fs/promises";

import { Pool } from "pg";

import { buildVerificationReport, type VerificationCheck } from "./lib/verification.js";

function url(name: string): string {
  const value = process.env[name];
  if (!value || !["postgres:", "postgresql:"].includes(new URL(value).protocol)) throw new Error(`${name} must be a PostgreSQL URL`);
  return value;
}

const source = new Pool({ connectionString: url("LEGACY_DATABASE_URL"), max: 2 });
const targets = {
  identity: new Pool({ connectionString: url("IDENTITY_DATABASE_URL"), max: 1 }),
  catalog: new Pool({ connectionString: url("CATALOG_DATABASE_URL"), max: 1 }),
  media: new Pool({ connectionString: url("MEDIA_DATABASE_URL"), max: 1 }),
  distribution: new Pool({ connectionString: url("DISTRIBUTION_DATABASE_URL"), max: 1 }),
  finance: new Pool({ connectionString: url("FINANCE_DATABASE_URL"), max: 1 }),
  notifications: new Pool({ connectionString: url("NOTIFICATION_DATABASE_URL"), max: 1 }),
  analytics: new Pool({ connectionString: url("ANALYTICS_DATABASE_URL"), max: 1 }),
  audit: new Pool({ connectionString: url("AUDIT_DATABASE_URL"), max: 1 })
};

async function scalar(pool: Pool, sql: string): Promise<string> {
  const result = await pool.query<{ value: unknown }>(sql);
  return String(result.rows[0]?.value ?? "0");
}

const results: VerificationCheck[] = [];
async function compare(name: string, sourceSql: string, target: keyof typeof targets, targetSql: string): Promise<void> {
  const [sourceValue, targetValue] = await Promise.all([scalar(source, sourceSql), scalar(targets[target], targetSql)]);
  results.push({ name, source: sourceValue, target: targetValue, passed: sourceValue === targetValue });
}
async function invariant(name: string, target: keyof typeof targets, targetSql: string, expected = "0"): Promise<void> {
  const targetValue = await scalar(targets[target], targetSql);
  results.push({ name, target: targetValue, passed: targetValue === expected });
}

try {
  await compare("identity.users", "SELECT count(*) AS value FROM auth.users", "identity", "SELECT count(*) AS value FROM users");
  await compare("identity.memberships", "SELECT count(DISTINCT user_id) AS value FROM auth.user_entity_roles", "identity", "SELECT count(*) AS value FROM memberships");
  for (const table of ["business_entities", "labels", "artists", "releases", "tracks", "compositions"] as const) await compare(`catalog.${table}`, `SELECT count(*) AS value FROM core.${table}`, "catalog", `SELECT count(*) AS value FROM ${table}`);
  await compare("media.assets", "SELECT count(*) AS value FROM core.assets", "media", "SELECT count(*) AS value FROM assets");
  await compare("distribution.deliveries", "SELECT count(*) AS value FROM ddex.deliveries", "distribution", "SELECT count(*) AS value FROM deliveries");
  await compare("finance.reports", "SELECT count(*) AS value FROM finance.royalty_reports", "finance", "SELECT count(*) AS value FROM royalty_reports");
  await compare("finance.line-items", "SELECT count(*) AS value FROM finance.royalty_line_items", "finance", "SELECT count(*) AS value FROM royalty_line_items");
  await compare("finance.revenue", "SELECT trim_scale(COALESCE(sum(total_revenue),0))::text AS value FROM finance.royalty_reports", "finance", "SELECT trim_scale(COALESCE(sum(total_revenue),0))::text AS value FROM royalty_reports");
  await compare("notifications", "SELECT count(*) AS value FROM auth.notifications", "notifications", "SELECT count(*) AS value FROM notifications");
  await compare("analytics.streaming-metrics", "SELECT count(*) AS value FROM analytics.streaming_metrics", "analytics", "SELECT count(*) AS value FROM streaming_metrics");
  await compare("audit.events", "SELECT count(*) AS value FROM log.audit_logs", "audit", "SELECT count(*) AS value FROM audit_events");
  await invariant("catalog.duplicate-ean", "catalog", "SELECT count(*)-count(DISTINCT ean) AS value FROM releases WHERE ean IS NOT NULL");
  await invariant("catalog.duplicate-isrc", "catalog", "SELECT count(*)-count(DISTINCT isrc) AS value FROM tracks WHERE isrc IS NOT NULL");
  await invariant("catalog.invalid-path", "catalog", "SELECT count(*) AS value FROM business_entities WHERE path IS NULL OR path='' OR path LIKE '%..%'");
  await invariant("media.invalid-owner-path", "media", "SELECT count(*) AS value FROM assets WHERE owner_entity_path IS NULL OR owner_entity_path=''");
  await invariant("media.missing-upload-intent", "media", "SELECT count(*) AS value FROM assets a LEFT JOIN upload_intents u ON u.id=a.upload_intent_id WHERE u.id IS NULL");
  await invariant("distribution.missing-snapshot", "distribution", "SELECT count(*) AS value FROM deliveries d LEFT JOIN delivery_snapshots s ON s.id=d.snapshot_id WHERE s.id IS NULL");
  await invariant("distribution.empty-ern", "distribution", "SELECT count(*) AS value FROM delivery_snapshots WHERE ern_xml IS NULL OR btrim(ern_xml)=''");
  await invariant("finance.float-types", "finance", "SELECT count(*) AS value FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('royalty_reports','royalty_line_items','royalty_allocations') AND data_type IN ('real','double precision')");
  const report = buildVerificationReport(results);
  const output = process.env.MIGRATION_VERIFY_REPORT ?? "migration-verification.json";
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  await Promise.all([source.end(), ...Object.values(targets).map(pool => pool.end())]);
}
