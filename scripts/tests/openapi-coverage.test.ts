import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const INTERNAL_OPERATIONS = new Set([
  "PUT /identity/internal/entity-snapshots",
  "GET /catalog/releases/{id}/distribution-snapshot",
  "GET /catalog/tracks/{id}/analytics-scope",
  "GET /catalog/internal/tenant-domains/resolve",
]);

function normalizeRoute(value: string): string {
  let route = value
    .replace(/^\/api\/v1/, "")
    .replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "{$1}");
  if (/^\/catalog\/releases\/\{id\}\/(submit|approve|deny)$/.test(route)) {
    route = route.replace("{id}", "{releaseId}");
  }
  return route;
}

function serviceOperations(root: string): Set<string> {
  const operations = new Set<string>();
  const services = path.join(root, "services");
  for (const service of readdirSync(services, { withFileTypes: true })) {
    if (!service.isDirectory()) continue;
    const routePath = path.join(services, service.name, "src", "routes.ts");
    let source: string;
    try {
      source = readFileSync(routePath, "utf8");
    } catch {
      continue;
    }
    const matcher = /app\.(get|post|put|patch|delete)(?:<[^;]*?>)?\(\s*["']([^"']+)/gs;
    for (const match of source.matchAll(matcher)) {
      if (!match[2]?.startsWith("/api/v1/")) continue;
      const operation = `${match[1]!.toUpperCase()} ${normalizeRoute(match[2])}`;
      if (!INTERNAL_OPERATIONS.has(operation)) operations.add(operation);
    }
  }
  return operations;
}

function documentedOperations(root: string): Set<string> {
  const operations = new Set<string>();
  const source = readFileSync(path.join(root, "docs", "api", "openapi.yaml"), "utf8");
  let currentPath: string | undefined;
  for (const line of source.split(/\r?\n/)) {
    const pathMatch = /^  (\/[^:]+):\s*$/.exec(line);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }
    const methodMatch = /^    (get|post|put|patch|delete):\s*$/.exec(line);
    if (methodMatch && currentPath) {
      operations.add(`${methodMatch[1].toUpperCase()} ${currentPath}`);
    }
  }
  return operations;
}

test("OpenAPI documents every public Gateway operation and no internal operation", () => {
  const root = process.cwd();
  const actual = documentedOperations(root);
  const expected = serviceOperations(root);
  assert.deepEqual([...actual].sort(), [...expected].sort());
  for (const operation of INTERNAL_OPERATIONS) assert.equal(actual.has(operation), false);
});
