import { open, stat } from "node:fs/promises";
import { MAX_DDEX_XML_BYTES, MAX_MEDIA_PATH_LENGTH, MAX_ZIP_BYTES, MAX_ZIP_COMPRESSION_RATIO, MAX_ZIP_ENTRIES } from "@bealpha/contracts";

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const MAX_EXPANDED_BYTES = BigInt(MAX_ZIP_BYTES) * 2n;

function safeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label}_TOO_LARGE`);
  return Number(value);
}

function validatePath(name: string): void {
  if (!name || name.length > MAX_MEDIA_PATH_LENGTH || name.includes("\0") || name.includes("\\") || name.includes("\uFFFD") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) throw new Error("ZIP_UNSAFE_PATH");
  const parts = name.split("/");
  if (parts.some(part => part === ".." || part === ".")) throw new Error("ZIP_UNSAFE_PATH");
}

function zip64Sizes(extra: Buffer, needUncompressed: boolean, needCompressed: boolean): { uncompressed?: bigint; compressed?: bigint } {
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const id = extra.readUInt16LE(offset);
    const size = extra.readUInt16LE(offset + 2);
    const start = offset + 4;
    const end = start + size;
    if (end > extra.length) throw new Error("ZIP_INVALID_EXTRA");
    if (id === 0x0001) {
      let cursor = start;
      const result: { uncompressed?: bigint; compressed?: bigint } = {};
      if (needUncompressed) { if (cursor + 8 > end) throw new Error("ZIP64_SIZE_MISSING"); result.uncompressed = extra.readBigUInt64LE(cursor); cursor += 8; }
      if (needCompressed) { if (cursor + 8 > end) throw new Error("ZIP64_SIZE_MISSING"); result.compressed = extra.readBigUInt64LE(cursor); }
      return result;
    }
    offset = end;
  }
  return {};
}

export async function validateZipArchive(filePath: string) {
  const info = await stat(filePath);
  if (!info.isFile() || info.size <= 0 || info.size > MAX_ZIP_BYTES) throw new Error("ZIP_SIZE_INVALID");
  const handle = await open(filePath, "r");
  try {
    const tailSize = Math.min(info.size, 65557);
    const tail = Buffer.allocUnsafe(tailSize);
    await handle.read(tail, 0, tailSize, info.size - tailSize);
    let eocd = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === EOCD_SIGNATURE) { eocd = index; break; }
    }
    if (eocd < 0) throw new Error("ZIP_EOCD_MISSING");
    if (tail.readUInt16LE(eocd + 4) !== 0 || tail.readUInt16LE(eocd + 6) !== 0) throw new Error("ZIP_MULTIDISK_FORBIDDEN");
    let entries = BigInt(tail.readUInt16LE(eocd + 10));
    let centralSize = BigInt(tail.readUInt32LE(eocd + 12));
    let centralOffset = BigInt(tail.readUInt32LE(eocd + 16));
    if (entries === 0xffffn || centralSize === 0xffffffffn || centralOffset === 0xffffffffn) {
      const locatorAt = eocd - 20;
      if (locatorAt < 0 || tail.readUInt32LE(locatorAt) !== ZIP64_LOCATOR_SIGNATURE) throw new Error("ZIP64_LOCATOR_MISSING");
      const recordOffset = safeNumber(tail.readBigUInt64LE(locatorAt + 8), "ZIP64_OFFSET");
      const record = Buffer.allocUnsafe(56);
      await handle.read(record, 0, record.length, recordOffset);
      if (record.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) throw new Error("ZIP64_EOCD_MISSING");
      entries = record.readBigUInt64LE(32);
      centralSize = record.readBigUInt64LE(40);
      centralOffset = record.readBigUInt64LE(48);
    }
    if (entries > BigInt(MAX_ZIP_ENTRIES)) throw new Error("ZIP_TOO_MANY_ENTRIES");
    const centralStart = safeNumber(centralOffset, "ZIP_CENTRAL_OFFSET");
    const centralBytes = safeNumber(centralSize, "ZIP_CENTRAL_SIZE");
    if (centralStart < 0 || centralBytes < 0 || centralStart + centralBytes > info.size) throw new Error("ZIP_CENTRAL_OUT_OF_BOUNDS");
    let position = centralStart;
    let compressedTotal = 0n;
    let expandedTotal = 0n;
    for (let index = 0; index < Number(entries); index += 1) {
      const header = Buffer.allocUnsafe(46);
      await handle.read(header, 0, header.length, position);
      if (header.readUInt32LE(0) !== CENTRAL_SIGNATURE) throw new Error("ZIP_CENTRAL_INVALID");
      const flags = header.readUInt16LE(8);
      const method = header.readUInt16LE(10);
      if ((flags & 1) !== 0) throw new Error("ZIP_ENCRYPTED_FORBIDDEN");
      if (![0, 8].includes(method)) throw new Error("ZIP_METHOD_FORBIDDEN");
      const nameLength = header.readUInt16LE(28);
      const extraLength = header.readUInt16LE(30);
      const commentLength = header.readUInt16LE(32);
      if (nameLength === 0 || nameLength > MAX_MEDIA_PATH_LENGTH) throw new Error("ZIP_UNSAFE_PATH");
      const variable = Buffer.allocUnsafe(nameLength + extraLength);
      await handle.read(variable, 0, variable.length, position + 46);
      const name = variable.subarray(0, nameLength).toString("utf8");
      validatePath(name);
      const madeByUnix = (header.readUInt16LE(4) >> 8) === 3;
      const unixType = (header.readUInt32LE(38) >>> 16) & 0o170000;
      if (madeByUnix && unixType === 0o120000) throw new Error("ZIP_SYMLINK_FORBIDDEN");
      const compressed32 = header.readUInt32LE(20);
      const expanded32 = header.readUInt32LE(24);
      const zip64 = zip64Sizes(variable.subarray(nameLength), expanded32 === 0xffffffff, compressed32 === 0xffffffff);
      const compressed = compressed32 === 0xffffffff ? zip64.compressed : BigInt(compressed32);
      const expanded = expanded32 === 0xffffffff ? zip64.uncompressed : BigInt(expanded32);
      if (compressed === undefined || expanded === undefined) throw new Error("ZIP64_SIZE_MISSING");
      if (expanded > 0n && compressed === 0n) throw new Error("ZIP_RATIO_INVALID");
      if (compressed > 0n && expanded / compressed > BigInt(MAX_ZIP_COMPRESSION_RATIO)) throw new Error("ZIP_RATIO_INVALID");
      compressedTotal += compressed;
      expandedTotal += expanded;
      if (expandedTotal > MAX_EXPANDED_BYTES) throw new Error("ZIP_EXPANDED_TOO_LARGE");
      position += 46 + nameLength + extraLength + commentLength;
      if (position > centralStart + centralBytes) throw new Error("ZIP_CENTRAL_OUT_OF_BOUNDS");
    }
    if (compressedTotal > BigInt(MAX_ZIP_BYTES) || (compressedTotal > 0n && expandedTotal / compressedTotal > BigInt(MAX_ZIP_COMPRESSION_RATIO))) throw new Error("ZIP_RATIO_INVALID");
    return { entries: Number(entries), compressedBytes: compressedTotal, expandedBytes: expandedTotal };
  } finally {
    await handle.close();
  }
}

export async function validateCatalogImportSource(filePath: string, fileName: string, contentType: string) {
  const isXml = fileName.toLowerCase().endsWith(".xml") || /(?:application|text)\/xml/i.test(contentType);
  const isCsv = fileName.toLowerCase().endsWith(".csv") || /(?:text\/csv|application\/csv)/i.test(contentType);
  if (!isXml && !isCsv) return { kind: "ZIP" as const, ...(await validateZipArchive(filePath)) };
  const info = await stat(filePath);
  const maxBytes = isCsv ? 50 * 1024 * 1024 : MAX_DDEX_XML_BYTES;
  if (!info.isFile() || info.size <= 0 || info.size > maxBytes) throw new Error(isCsv ? "CSV_SIZE_INVALID" : "DDEX_XML_SIZE_INVALID");
  const handle = await open(filePath, "r");
  try {
    const header = Buffer.alloc(Math.min(info.size, 64 * 1024));
    await handle.read(header, 0, header.length, 0);
    const sample = header.toString("utf8").replace(/^\uFEFF/, "").trimStart();
    if (isCsv) {
      if (sample.includes("\0") || (!sample.includes(",") && !sample.includes(";"))) throw new Error("CSV_MAGIC_INVALID");
      return { kind: "CSV" as const, bytes: info.size };
    }
    if (!sample.startsWith("<?xml") && !/^<[A-Za-z_][\w:.-]*(?:\s|>)/.test(sample)) throw new Error("DDEX_XML_MAGIC_INVALID");
    if (/<!DOCTYPE|<!ENTITY/i.test(sample)) throw new Error("DDEX_XML_DOCTYPE_FORBIDDEN");
    return { kind: "XML" as const, bytes: info.size };
  } finally {
    await handle.close();
  }
}
