import assert from "node:assert/strict";
import test from "node:test";

import type { PoolClient } from "pg";

import { canonicalSnapshotHash, copyQuery, quote, stableUuid, type MigrationContext } from "../lib/migration.js";
import { buildVerificationReport } from "../lib/verification.js";

test("stableUuid is deterministic and RFC-4122 shaped", () => {
  const first = stableUuid("asset", "123");
  assert.equal(first, stableUuid("asset", "123"));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first, stableUuid("asset", "124"));
});

test("quote rejects SQL identifier injection", () => {
  assert.equal(quote("royalty_reports"), '"royalty_reports"');
  assert.throws(() => quote('users; DROP TABLE users'));
});

test("DDEX migration snapshot hash matches canonical runtime framing", () => {
  const payload = { migratedFrom: "legacy", legacyDeliveryId: "d1", releaseId: "r1" };
  assert.equal(canonicalSnapshotHash(payload, "<ern/>"), "53de63ea208629410e7a29e79bf0fd8048bebcf106bbdfdc079ca258976c5b7f");
});

test("copyQuery resumes from durable checkpoint", async () => {
  const loadedOffsets: number[] = [];
  const inserted: string[] = [];
  const targetQueries: string[] = [];
  const client = {
    query: async (sql: string) => {
      targetQueries.push(sql);
      return { rows: [] };
    },
    release: () => undefined,
  } as unknown as PoolClient;
  const target = {
    query: async (sql: string) => {
      targetQueries.push(sql);
      if (sql.startsWith("SELECT offset_rows")) {
        return { rows: [{ offset_rows: "2", copied_rows: "2", completed_at: null }] };
      }
      return { rows: [] };
    },
    connect: async () => client,
  };
  const context = {
    dryRun: false,
    migration: "test-v1",
    target,
  } as unknown as MigrationContext;

  const copied = await copyQuery(
    context,
    "rows",
    async offset => {
      loadedOffsets.push(offset);
      return offset === 2 ? [{ id: "three" }] : [];
    },
    async (_client, rows) => {
      inserted.push(...rows.map(row => row.id));
    },
  );

  assert.equal(copied, 3);
  assert.deepEqual(loadedOffsets, [2, 3]);
  assert.deepEqual(inserted, ["three"]);
  assert.ok(targetQueries.some(sql => sql.includes("completed_at")));
});

test("copyQuery dry-run performs no target writes", async () => {
  let insertCalled = false;
  const context = {
    dryRun: true,
    migration: "test-v1",
    target: {
      query: async () => { throw new Error("target query not allowed"); },
      connect: async () => { throw new Error("target connection not allowed"); },
    },
  } as unknown as MigrationContext;

  const copied = await copyQuery(
    context,
    "rows",
    async offset => offset === 0 ? [{ id: "one" }] : [],
    async () => { insertCalled = true; },
  );

  assert.equal(copied, 1);
  assert.equal(insertCalled, false);
});

test("verification report fails when any check fails or no checks ran", () => {
  const failed = buildVerificationReport([
    { name: "users", source: "2", target: "1", passed: false },
  ], new Date("2026-07-15T00:00:00.000Z"));

  assert.equal(failed.passed, false);
  assert.equal(buildVerificationReport([]).passed, false);
});
