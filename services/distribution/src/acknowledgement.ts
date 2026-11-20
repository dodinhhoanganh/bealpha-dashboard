import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

const supplyChainStatusSchema = z.enum([
  "DeliveredToReleaseDistributor",
  "InDeliveryToReleaseDistributor",
  "InPreparationForDeliveryToReleaseDistributor",
  "OrderPlacedForReleaseDistributor",
  "ProcessingErrorAtReleaseCreator",
  "ProcessingErrorAtReleaseDistributor",
  "ReleaseMadeAvailableToConsumers",
  "ReleaseNotAvailable",
  "ReleaseReceivedByReleaseDistributor",
  "ReleaseStagedForPublication",
  "ReleaseViolatesTermsOfService",
  "RightsConflict",
  "SuccessfullyIngestedByReleaseDistributor",
  "UserDefined"
]);
const nonEmpty = z.string().trim().min(1).max(1000);
const parsedSchema = z.object({
  AcknowledgementMessage: z.object({
    "@_AvsVersionId": z.string().regex(/^\d+$/),
    MessageHeader: z.object({
      MessageId: nonEmpty,
      MessageSender: z.object({ PartyId: nonEmpty }).passthrough(),
      MessageRecipient: z.array(z.object({ PartyId: nonEmpty }).passthrough()).min(1),
      MessageCreatedDateTime: z.string().datetime({ offset: true })
    }).passthrough(),
    ReleaseStatus: z.array(z.object({
      ReleaseId: z.object({ ICPN: z.string().regex(/^\d{12,14}$/).optional() }).passthrough(),
      ReleaseStatus: supplyChainStatusSchema,
      ErrorText: nonEmpty.optional(),
      Acknowledgement: z.array(z.object({
        MessageType: z.literal("NewReleaseMessage"),
        MessageId: nonEmpty,
        MessageStatus: z.array(z.object({ Status: nonEmpty, Information: nonEmpty.optional() }).passthrough()).min(1)
      }).passthrough()).min(1)
    }).passthrough()).length(1)
  }).passthrough()
}).passthrough();

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  processEntities: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (_tagName, path) => typeof path === "string" && new Set([
    "AcknowledgementMessage.MessageHeader.MessageRecipient",
    "AcknowledgementMessage.ReleaseStatus",
    "AcknowledgementMessage.ReleaseStatus.Acknowledgement",
    "AcknowledgementMessage.ReleaseStatus.Acknowledgement.MessageStatus"
  ]).has(path)
});

export interface ParsedAcknowledgement {
  acknowledgementMessageId: string;
  referencedMessageId: string;
  senderPartyId: string;
  recipientPartyIds: string[];
  releaseId?: string;
  supplyChainStatus: z.infer<typeof supplyChainStatusSchema>;
  fileStatuses: Array<{ status: string; information?: string }>;
  errorText?: string;
  messageCreatedAt: Date;
  rawSha256: string;
}

export function parseAcknowledgement(xmlDocument: string): ParsedAcknowledgement {
  if (Buffer.byteLength(xmlDocument, "utf8") > 64 * 1024) throw new Error("DDEX_ACK_TOO_LARGE");
  if (/<!DOCTYPE|<!ENTITY/i.test(xmlDocument)) throw new Error("DDEX_ACK_DTD_FORBIDDEN");
  const result = parsedSchema.safeParse(parser.parse(xmlDocument));
  if (!result.success) throw new Error("DDEX_ACK_STRUCTURE_INVALID");
  const message = result.data.AcknowledgementMessage;
  const releaseStatus = message.ReleaseStatus[0];
  if (releaseStatus.Acknowledgement.length !== 1) throw new Error("DDEX_ACK_AMBIGUOUS");
  const acknowledgement = releaseStatus.Acknowledgement[0];
  return {
    acknowledgementMessageId: message.MessageHeader.MessageId,
    referencedMessageId: acknowledgement.MessageId,
    senderPartyId: message.MessageHeader.MessageSender.PartyId,
    recipientPartyIds: message.MessageHeader.MessageRecipient.map(item => item.PartyId),
    ...(releaseStatus.ReleaseId.ICPN ? { releaseId: releaseStatus.ReleaseId.ICPN } : {}),
    supplyChainStatus: releaseStatus.ReleaseStatus,
    fileStatuses: acknowledgement.MessageStatus.map(item => ({ status: item.Status, ...(item.Information ? { information: item.Information } : {}) })),
    ...(releaseStatus.ErrorText ? { errorText: releaseStatus.ErrorText } : {}),
    messageCreatedAt: new Date(message.MessageHeader.MessageCreatedDateTime),
    rawSha256: createHash("sha256").update(xmlDocument).digest("hex")
  };
}

export function assertAcknowledgementMatches(input: ParsedAcknowledgement, expected: { fileName: string; messageId: string; releaseId: string; senderPartyId: string; recipientPartyId: string }) {
  const escaped = expected.messageId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`^ACK_${escaped}_\\d{17}\\.xml$`).test(expected.fileName)) throw new Error("DDEX_ACK_FILENAME_INVALID");
  if (input.referencedMessageId !== expected.messageId) throw new Error("DDEX_ACK_MESSAGE_MISMATCH");
  if (input.releaseId !== expected.releaseId) throw new Error("DDEX_ACK_RELEASE_MISMATCH");
  if (input.senderPartyId !== expected.senderPartyId) throw new Error("DDEX_ACK_SENDER_MISMATCH");
  if (!input.recipientPartyIds.includes(expected.recipientPartyId)) throw new Error("DDEX_ACK_RECIPIENT_MISMATCH");
}

const failureStatuses = new Set(["ProcessingErrorAtReleaseCreator", "ProcessingErrorAtReleaseDistributor", "ReleaseViolatesTermsOfService", "RightsConflict"]);
const confirmedStatuses = new Set(["ReleaseReceivedByReleaseDistributor", "SuccessfullyIngestedByReleaseDistributor", "ReleaseMadeAvailableToConsumers"]);

export function acknowledgementOutcome(input: ParsedAcknowledgement): "CONFIRMED" | "FAILED" | "SENT" {
  if (failureStatuses.has(input.supplyChainStatus) || input.fileStatuses.some(item => item.status !== "FileOK")) return "FAILED";
  if (confirmedStatuses.has(input.supplyChainStatus) && input.fileStatuses.every(item => item.status === "FileOK")) return "CONFIRMED";
  return "SENT";
}
