import { z } from 'zod';
import type { CensusExportRecord } from '@/services/contracts/censusExportServiceContracts';
import type { CensusWorkbookSheetDescriptor } from '@/services/exporters/censusMasterWorkbook';

export const ServerlessErrorResponseSchema = z.object({
  error: z.string(),
});

export type ServerlessErrorResponse = z.infer<typeof ServerlessErrorResponseSchema>;

export const Cie10SearchResultSchema = z.object({
  code: z.string(),
  description: z.string(),
  category: z.string().optional(),
});

export const Cie10SearchRequestSchema = z.object({
  query: z.string(),
  /** When provided, the serverless function uses this as the full AI prompt
   *  instead of wrapping query in the default CIE-10 template.
   *  Used by FONASA search to send its own specialized prompt. */
  prompt: z.string().optional(),
});

export type Cie10SearchRequest = z.infer<typeof Cie10SearchRequestSchema>;

export const Cie10SearchResponseSchema = z.object({
  available: z.boolean(),
  results: z.array(Cie10SearchResultSchema).optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

export type Cie10SearchResponse = z.infer<typeof Cie10SearchResponseSchema>;

export const ClinicalSummaryRequestSchema = z.object({
  recordDate: z.string(),
  bedId: z.string(),
  instruction: z.string().optional(),
});

export type ClinicalSummaryRequest = z.infer<typeof ClinicalSummaryRequestSchema>;

export const ClinicalSummaryResponseSchema = z.object({
  available: z.boolean(),
  provider: z.string().optional(),
  model: z.string().optional(),
  summary: z.string(),
  message: z.string().optional(),
});

export type ClinicalSummaryResponse = z.infer<typeof ClinicalSummaryResponseSchema>;

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

export type ClinicalDocumentAiImportRequest = z.infer<typeof ClinicalDocumentAiImportRequestSchema>;

export const ClinicalDocumentAiImportResponseSchema = z.object({
  available: z.boolean(),
  provider: z.string().optional(),
  model: z.string().optional(),
  document: ClinicalDocumentAiImportPayloadSchema.optional(),
  message: z.string().optional(),
});

export type ClinicalDocumentAiImportResponse = z.infer<
  typeof ClinicalDocumentAiImportResponseSchema
>;

export const ClinicalAttachmentNameSuggestionRequestSchema = z.object({
  attachment: z.object({
    originalFileName: z.string(),
    displayName: z.string(),
    fileKind: z.string(),
    contentType: z.string().optional(),
    documentType: z.string().optional(),
    admissionDate: z.string().optional(),
    sourceDailyRecordDate: z.string().optional(),
  }),
  document: z
    .object({
      id: z.string().optional(),
      documentType: z.string().optional(),
      admissionDate: z.string().optional(),
      sourceDailyRecordDate: z.string().optional(),
    })
    .optional(),
});

export type ClinicalAttachmentNameSuggestionRequest = z.infer<
  typeof ClinicalAttachmentNameSuggestionRequestSchema
>;

export const ClinicalAttachmentNameSuggestionResponseSchema = z.object({
  available: z.boolean(),
  provider: z.string().optional(),
  model: z.string().optional(),
  suggestedName: z.string().optional(),
  message: z.string().optional(),
});

export type ClinicalAttachmentNameSuggestionResponse = z.infer<
  typeof ClinicalAttachmentNameSuggestionResponseSchema
>;

export const FhirIssueSchema = z.object({
  severity: z.string(),
  code: z.string(),
  diagnostics: z.string(),
});

export const FhirOperationOutcomeSchema = z.object({
  resourceType: z.literal('OperationOutcome'),
  issue: z.array(FhirIssueSchema).min(1),
});

export type FhirOperationOutcome = z.infer<typeof FhirOperationOutcomeSchema>;

export const FhirCapabilityStatementSchema = z.object({
  resourceType: z.literal('CapabilityStatement'),
  status: z.string(),
  date: z.string(),
  kind: z.string(),
  software: z.object({
    name: z.string(),
    version: z.string(),
  }),
  implementation: z.object({
    description: z.string(),
  }),
  fhirVersion: z.string(),
  format: z.array(z.string()),
  rest: z.array(
    z.object({
      mode: z.string(),
      resource: z.array(
        z.object({
          type: z.string(),
          interaction: z.array(z.object({ code: z.string() })),
        })
      ),
    })
  ),
});

export type FhirCapabilityStatement = z.infer<typeof FhirCapabilityStatementSchema>;

const CensusWorkbookSheetDescriptorSchema: z.ZodType<CensusWorkbookSheetDescriptor> = z.custom();
const CensusExportRecordArraySchema: z.ZodType<CensusExportRecord[]> = z.custom(
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

export const CensusEmailRequestPayloadSchema: z.ZodType<CensusEmailRequestPayload> = z.object({
  date: z.string(),
  records: CensusExportRecordArraySchema,
  recipients: z.array(z.string()).optional(),
  nursesSignature: z.string().optional(),
  body: z.string().optional(),
  shareLink: z.string().optional(),
  sheetDescriptors: z.array(CensusWorkbookSheetDescriptorSchema).optional(),
});

export const CensusEmailResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  gmailId: z.string(),
  censusDate: z.string().optional(),
  exportPassword: z.string().optional(),
});

export type CensusEmailResponse = z.infer<typeof CensusEmailResponseSchema>;

export const getServerlessErrorMessage = (payload: unknown, fallbackMessage: string): string => {
  const parsed = ServerlessErrorResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data.error : fallbackMessage;
};
