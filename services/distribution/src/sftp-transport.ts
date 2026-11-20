import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { DistributionConfig, SftpTarget } from "./config.js";
import { buildDeliveryPackage, type DeliveryPackageArtifact, type PackageDelivery } from "./package-builder.js";

function quoted(value: string) {
  if (/["\r\n]/.test(value)) throw new Error("SFTP_PATH_INVALID");
  return `"${value}"`;
}

type SftpRunner = (target: SftpTarget, batch: string) => Promise<string | void>;

function connect(target: SftpTarget, batch: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("sftp", ["-b", "-", "-P", String(target.port), "-i", target.privateKeyPath, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${target.knownHostsPath}`, `${target.username}@${target.host}`], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stderr = "";
    let stdout = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(stdout);
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error("SFTP_UPLOAD_TIMEOUT")); }, 60 * 60 * 1000);
    child.stderr.on("data", chunk => { if (stderr.length < 8192) stderr += chunk.toString(); });
    child.stdout.on("data", chunk => { if (stdout.length < 128 * 1024) stdout += chunk.toString(); else finish(new Error("SFTP_OUTPUT_TOO_LARGE")); });
    child.on("error", error => finish(error));
    child.on("close", code => finish(code === 0 ? undefined : new Error(`SFTP_UPLOAD_FAILED: ${stderr.slice(0, 1000)}`)));
    child.stdin.on("error", error => finish(error));
    child.stdin.end(batch);
  });
}

function remoteRoot(artifact: DeliveryPackageArtifact, target: SftpTarget) {
  return `${target.remoteDir.replace(/\/$/, "")}/${artifact.folderName}`;
}

function uploadBatch(artifact: DeliveryPackageArtifact, target: SftpTarget) {
  const destination = remoteRoot(artifact, target);
  const partial = `${destination}.partial`;
  const resources = artifact.entries.filter(entry => entry.startsWith("resources/"));
  const cleanup = [
    ...resources.map(entry => `-rm ${quoted(`${partial}/${entry}`)}`),
    `-rm ${quoted(`${partial}/${artifact.messageFileName}`)}`,
    `-rmdir ${quoted(`${partial}/acknowledgements`)}`,
    `-rmdir ${quoted(`${partial}/resources`)}`,
    `-rmdir ${quoted(partial)}`
  ];
  const uploadResources = resources.map(entry => `put ${quoted(path.join(artifact.rootPath, ...entry.split("/")))} ${quoted(`${partial}/${entry}`)}`);
  return `${[
    ...cleanup,
    `mkdir ${quoted(partial)}`,
    `mkdir ${quoted(`${partial}/resources`)}`,
    `mkdir ${quoted(`${partial}/acknowledgements`)}`,
    ...uploadResources,
    // The ERN is the completion signal and is intentionally uploaded last.
    `put ${quoted(path.join(artifact.rootPath, artifact.messageFileName))} ${quoted(`${partial}/${artifact.messageFileName}`)}`,
    `rename ${quoted(partial)} ${quoted(destination)}`
  ].join("\n")}\n`;
}

async function probeRemoteErn(artifact: DeliveryPackageArtifact, target: SftpTarget, runner: SftpRunner): Promise<"MATCH" | "CONFLICT" | "UNAVAILABLE"> {
  const localProbe = path.join(artifact.rootPath, `.remote-${randomUUID()}.xml`);
  const remoteMessage = `${remoteRoot(artifact, target)}/${artifact.messageFileName}`;
  try {
    await runner(target, `get ${quoted(remoteMessage)} ${quoted(localProbe)}\n`);
    const [local, remote] = await Promise.all([readFile(path.join(artifact.rootPath, artifact.messageFileName)), readFile(localProbe)]);
    return local.equals(remote) ? "MATCH" : "CONFLICT";
  } catch {
    return "UNAVAILABLE";
  } finally {
    await rm(localProbe, { force: true }).catch(() => undefined);
  }
}

export class SftpDeliveryTransport {
  constructor(private readonly config: DistributionConfig, private readonly runner: SftpRunner = connect) {}

  async send(delivery: PackageDelivery & { dsp: string }) {
    const target = this.config.sftpTargets[delivery.dsp];
    if (!target) throw new Error("DISTRIBUTION_TRANSPORT_NOT_CONFIGURED");
    const artifact = await buildDeliveryPackage(delivery, this.config, target.priority);
    const existing = await probeRemoteErn(artifact, target, this.runner);
    if (existing === "MATCH") return { remoteFolder: artifact.folderName };
    if (existing === "CONFLICT") throw new Error("SFTP_REMOTE_FOLDER_CONFLICT");
    try {
      await this.runner(target, uploadBatch(artifact, target));
    } catch (error) {
      const afterFailure = await probeRemoteErn(artifact, target, this.runner);
      if (afterFailure === "MATCH") return { remoteFolder: artifact.folderName };
      if (afterFailure === "CONFLICT") throw new Error("SFTP_REMOTE_FOLDER_CONFLICT");
      throw error;
    }
    return { remoteFolder: artifact.folderName };
  }

  async cleanup(delivery: { id: string }) {
    await rm(path.resolve(this.config.packageRoot, delivery.id), { recursive: true, force: true });
  }
}

export interface SftpAcknowledgementDelivery { id: string; dsp: string; messageId: string; remoteFolder: string; }
export interface DownloadedAcknowledgement { fileName: string; xml: string; }

export class SftpAcknowledgementTransport {
  constructor(private readonly config: DistributionConfig, private readonly runner: SftpRunner = connect) {}

  async poll(delivery: SftpAcknowledgementDelivery): Promise<DownloadedAcknowledgement[]> {
    const target = this.config.sftpTargets[delivery.dsp];
    if (!target) throw new Error("DISTRIBUTION_TRANSPORT_NOT_CONFIGURED");
    if (!/^[PNL]_\d{12,14}_\d{17}$/.test(delivery.remoteFolder)) throw new Error("SFTP_REMOTE_FOLDER_INVALID");
    const acknowledgementDir = `${target.remoteDir.replace(/\/$/, "")}/${delivery.remoteFolder}/acknowledgements`;
    const output = await this.runner(target, `ls -1 ${quoted(acknowledgementDir)}\n`);
    const escapedMessageId = delivery.messageId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expected = new RegExp(`^ACK_${escapedMessageId}_\\d{17}\\.xml$`);
    const fileNames = [...new Set(String(output ?? "").split(/\r?\n/).map(line => path.posix.basename(line.trim())).filter(name => expected.test(name)))].sort();
    if (fileNames.length > 100) throw new Error("SFTP_ACK_LIST_TOO_LARGE");
    const acknowledgements: DownloadedAcknowledgement[] = [];
    for (const fileName of fileNames) {
      const directory = await mkdtemp(path.join(tmpdir(), "bealpha-ddex-ack-"));
      const localPath = path.join(directory, fileName);
      try {
        await this.runner(target, `get ${quoted(`${acknowledgementDir}/${fileName}`)} ${quoted(localPath)}\n`);
        if ((await stat(localPath)).size > 64 * 1024) throw new Error("DDEX_ACK_TOO_LARGE");
        acknowledgements.push({ fileName, xml: await readFile(localPath, "utf8") });
      } finally {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    return acknowledgements;
  }
}
