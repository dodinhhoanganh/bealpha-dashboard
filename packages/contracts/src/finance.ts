import { z } from "zod";
import { basisPointsSchema } from "./catalog.js";
export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);
export const decimalAmountSchema = z
    .string()
    .regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,18})?$/);
export const integerAmountSchema = z.string().regex(/^-?(?:0|[1-9]\d*)$/);
export const moneySchema = z
    .object({
    amount: decimalAmountSchema,
    currency: currencyCodeSchema
})
    .strict();
export const minorMoneySchema = z
    .object({
    amountMinor: integerAmountSchema,
    currency: currencyCodeSchema
})
    .strict();
export const splitAllocationSchema = z
    .object({
    partyId: z.string().min(1).max(128),
    basisPoints: basisPointsSchema
})
    .strict();
export const financeImportIntentRequestSchema = z.object({
    platform: z.string().trim().min(1).max(100),
    period: z.string().trim().min(1).max(64),
    currency: currencyCodeSchema,
    fileName: z.string().trim().min(1).max(255).regex(/\.(?:csv|tsv)$/i),
    contentType: z.enum(["text/csv", "text/tab-separated-values"]),
    sizeBytes: z.number().int().positive().max(50 * 1024 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
export const financeReportQuerySchema = z.object({
    period: z.string().trim().min(1).max(64).optional(),
    platform: z.string().trim().min(1).max(100).optional(),
    status: z.string().trim().min(1).max(20).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().uuid().optional()
}).strict();
export const financeSplitRuleRequestSchema = z.object({ retainedBasisPoints: basisPointsSchema }).strict();

export type Money = z.infer<typeof moneySchema>;
export type MinorMoney = z.infer<typeof minorMoneySchema>;
export type SplitAllocation = z.infer<typeof splitAllocationSchema>;
export type FinanceImportIntentRequest = z.infer<typeof financeImportIntentRequestSchema>;
export type FinanceReportQuery = z.infer<typeof financeReportQuerySchema>;
export type FinanceSplitRuleRequest = z.infer<typeof financeSplitRuleRequestSchema>;
