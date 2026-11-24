import * as z from 'zod/mini';
import type { CensusExportRecord } from '@/services/contracts/censusExportServiceContracts';
import type { CensusWorkbookSheetDescriptor } from '@/services/exporters/censusMasterWorkbook';

export const ServerlessErrorResponseSchema = z.object({
  error: z.string(),
});

export const Cie10SearchResultSchema = z.object({
  code: z.string(),
  description: z.string(),
  category: z.optional(z.string()),
});

export const Cie10SearchRequestSchema = z.object({
  query: z.string(),
  /** When provided, the serverless function uses this as the full AI prompt
   *  instead of wrapping query in the default CIE-10 template.
   *  Used by FONASA search to send its own specialized prompt. */
  prompt: z.optional(z.string()),
});

export type Cie10SearchRequest = z.infer<typeof Cie10SearchRequestSchema>;

export const Cie10SearchResponseSchema = z.object({
  available: z.boolean(),
  results: z.optional(z.array(Cie10SearchResultSchema)),
  message: z.optional(z.string()),
  error: z.optional(z.string()),
});

export const ClinicalDocumentAiImportPayloadSchema = z.object({
  antecedentes: z.string(),
  historiaEvolucionClinica: z.string(),
  examenesComplementarios: z.string(),
  diagnosticosEgreso: z.string(),
  planEgreso: z.string(),
});

export type ClinicalDocumentAiImportPayload = z.infer<typeof ClinicalDocumentAiImportPayloadSchema>;

export const ClinicalDocumentAiImportRequestSchema = z.object({
  sourceText: z.string(),
});

export const ClinicalDocumentAiImportResponseSchema = z.object({
  available: z.boolean(),
  provider: z.optional(z.string()),
  model: z.optional(z.string()),
  document: z.optional(ClinicalDocumentAiImportPayloadSchema),
  message: z.optional(z.string()),
});

export const ClinicalAttachmentNameSuggestionRequestSchema = z.object({
  attachment: z.object({
    originalFileName: z.string(),
    displayName: z.string(),
    fileKind: z.string(),
    contentType: z.optional(z.string()),
    documentType: z.optional(z.string()),
    admissionDate: z.optional(z.string()),
    sourceDailyRecordDate: z.optional(z.string()),
  }),
  document: z.optional(
    z.object({
      id: z.optional(z.string()),
      documentType: z.optional(z.string()),
      admissionDate: z.optional(z.string()),
      sourceDailyRecordDate: z.optional(z.string()),
    })
  ),
});

export const ClinicalAttachmentNameSuggestionResponseSchema = z.object({
  available: z.boolean(),
  provider: z.optional(z.string()),
  model: z.optional(z.string()),
  suggestedName: z.optional(z.string()),
  message: z.optional(z.string()),
});

const CensusWorkbookSheetDescriptorSchema = z.custom<CensusWorkbookSheetDescriptor>();
const CensusExportRecordArraySchema = z.custom<CensusExportRecord[]>(
  (value): value is CensusExportRecord[] =>
    Array.isArray(value) &&
    value.every(
      item =>
        typeof item === 'object' && item !== null && 'date' in item && typeof item.date === 'string'
    )
);

export interface CensusEmailRequestPayload {
  date: string;
  records: CensusExportRecord[];
  recipients?: string[];
  nursesSignature?: string;
  body?: string;
  shareLink?: string;
  sheetDescriptors?: CensusWorkbookSheetDescriptor[];
}

export const CensusEmailRequestPayloadSchema: z.ZodMiniType<CensusEmailRequestPayload> = z.object({
  date: z.string(),
  records: CensusExportRecordArraySchema,
  recipients: z.optional(z.array(z.string())),
  nursesSignature: z.optional(z.string()),
  body: z.optional(z.string()),
  shareLink: z.optional(z.string()),
  sheetDescriptors: z.optional(z.array(CensusWorkbookSheetDescriptorSchema)),
});

export const CensusEmailResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  gmailId: z.string(),
  censusDate: z.optional(z.string()),
  exportPassword: z.optional(z.string()),
});

export type CensusEmailResponse = z.infer<typeof CensusEmailResponseSchema>;

export const getServerlessErrorMessage = (payload: unknown, fallbackMessage: string): string => {
  const parsed = ServerlessErrorResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data.error : fallbackMessage;
};
