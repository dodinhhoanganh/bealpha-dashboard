import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ExportService as CurrentExportService } from "../src/export-service.js";
import { VevoService as CurrentVevoService } from "../src/vevo-service.js";
import { createExportToken } from "../src/export-token.js";
import type { DistributionConfig } from "../src/config.js";

const { ExportService } = process.env.DOWNLOAD_EXPORT_TEST_SOURCE
  ? await import(process.env.DOWNLOAD_EXPORT_TEST_SOURCE) as { ExportService: typeof CurrentExportService }
  : { ExportService: CurrentExportService };
const { VevoService } = process.env.DOWNLOAD_VEVO_TEST_SOURCE
  ? await import(process.env.DOWNLOAD_VEVO_TEST_SOURCE) as { VevoService: typeof CurrentVevoService }
  : { VevoService: CurrentVevoService };
const fixtureRoot = path.resolve("../../.task-transaction/package-download-containment/fixtures");
const cleanup: string[] = [];
const id = "10000000-0000-4000-8000-000000000001";
const key = Buffer.alloc(32, 7);
const token = () => createExportToken(id, 60, key);

afterEach(async () => {
  for (const directory of cleanup.splice(0)) {
    const relative = path.relative(fixtureRoot, path.resolve(directory));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Fixture cleanup escaped its root");
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture(kind: "export" | "vevo") {
  await mkdir(fixtureRoot, { recursive: true });
  const directory = await mkdtemp(path.join(fixtureRoot, `${kind}-`));
  cleanup.push(directory);
  const root = path.join(directory, "packages");
  const outside = path.join(directory, "outside");
  await mkdir(root);
  await mkdir(outside);
  const content = Buffer.from("PACKAGE");
  const insidePath = path.join(root, "manual.zip");
  await writeFile(insidePath, content);
  const record = {
    id, status: kind === "export" ? "COMPLETE" : "READY_FOR_MANUAL_DELIVERY",
    outputPath: insidePath, fileName: "manual.zip", contentType: "application/zip", sizeBytes: BigInt(content.length), expiresAt: new Date(Date.now() + 60_000),
    packagePath: insidePath, packageFileName: "manual.zip", packageSizeBytes: BigInt(content.length), packageExpiresAt: new Date(Date.now() + 60_000),
  };
  const lookup = vi.fn(async () => record);
  const config = { packageRoot: root, exportDownloadSigningKey: key } as DistributionConfig;
  const database = { prisma: { exportJob: { findUnique: lookup }, vevoSubmission: { findUnique: lookup } } };
  const service = kind === "export" ? new ExportService(database as never, config) : new VevoService(database as never, config);
  const open = (value = token()) => service instanceof ExportService ? service.openExport(id, value) : service.openPackage(id, value);
  const target = (file: string) => { record.outputPath = file; record.packagePath = file; };
  return { directory, root, outside, content, record, lookup, open, target };
}

describe.each(["export", "vevo"] as const)("%s package download containment", kind => {
  it("streams a real in-root file with valid token and size", async () => {
    const { open, content } = await fixture(kind);
    const opened = await open();
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(content);
    expect(opened.sizeBytes).toBe(content.length);
  });

  it("rejects a junction that resolves outside package root", async () => {
    const { root, outside, content, target, open } = await fixture(kind);
    await writeFile(path.join(outside, "manual.zip"), content);
    const alias = path.join(root, "alias");
    await symlink(outside, alias, "junction");
    expect(await realpath(alias)).toBe(await realpath(outside));
    target(path.join(alias, "manual.zip"));
    await expect(open().then(opened => { opened.stream.destroy(); return opened; })).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
  });

  it("allows an in-root directory alias without weakening containment", async () => {
    const { root, open, target, content } = await fixture(kind);
    const nested = path.join(root, "nested");
    await mkdir(nested);
    await writeFile(path.join(nested, "manual.zip"), content);
    const alias = path.join(root, "alias");
    await symlink(nested, alias, "junction");
    target(path.join(alias, "manual.zip"));
    const opened = await open();
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(content);
  });

  it("keeps lexical traversal and size checks", async () => {
    const { outside, target, open, content, record, root } = await fixture(kind);
    await writeFile(path.join(outside, "manual.zip"), content);
    target(path.join(outside, "manual.zip"));
    await expect(open()).rejects.toMatchObject({ code: "NOT_FOUND" });
    target(path.join(root, "manual.zip"));
    record.sizeBytes += 1n;
    record.packageSizeBytes += 1n;
    await expect(open()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("streams the verified descriptor even if the filename is replaced", async () => {
    const { root, open, content } = await fixture(kind);
    const opened = await open();
    try {
      expect(opened.stream.path).toBeUndefined();
      await rename(path.join(root, "manual.zip"), path.join(root, "original.zip"));
      await writeFile(path.join(root, "manual.zip"), Buffer.from("CHANGED"));
      const chunks: Buffer[] = [];
      for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks)).toEqual(content);
    } finally {
      opened.stream.destroy();
    }
  });

  it("rejects a directory instead of streaming a non-regular file", async () => {
    const { root, target, open } = await fixture(kind);
    const directory = path.join(root, "folder.zip");
    await mkdir(directory);
    target(directory);
    await expect(open()).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
  });

  it("rejects invalid tokens before DB lookup and expired packages before opening", async () => {
    const { open, record, lookup } = await fixture(kind);
    await expect(open("0.invalid")).rejects.toMatchObject({ statusCode: 401 });
    expect(lookup).not.toHaveBeenCalled();
    record.expiresAt = new Date(0);
    record.packageExpiresAt = new Date(0);
    await expect(open()).rejects.toMatchObject({ statusCode: 404 });
  });
});
