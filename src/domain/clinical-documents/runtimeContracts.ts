import * as z from 'zod/mini';
import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';

const clinicalDocumentTypeSchema = z.enum([
  'epicrisis',
  'evolucion',
  'informe_medico',
  'epicrisis_traslado',
  'otro',
]);
const clinicalDocumentStatusSchema = z.enum(['draft', 'ready_for_signature', 'signed', 'archived']);
const auditActorSchema = z.object({
  uid: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: z.string(),
});
const patientFieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string(),
  type: z.enum(['text', 'date', 'number', 'time']),
  placeholder: z.optional(z.string()),
  readonly: z.optional(z.boolean()),
  visible: z.optional(z.boolean()),
});
export const clinicalDocumentSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  kind: z.optional(z.enum(['standard', 'clinical-update'])),
  layout: z.optional(z.enum(['structured', 'unified'])),
  updateDate: z.optional(z.string()),
  updateTime: z.optional(z.string()),
  order: z.number(),
  required: z.optional(z.boolean()),
  visible: z.optional(z.boolean()),
});
const versionSectionSnapshotSchema = z.object({
  sectionId: z.string(),
  title: z.string(),
  content: z.string(),
  order: z.number(),
  kind: z.optional(z.enum(['standard', 'clinical-update'])),
});
const versionHistorySchema = z.object({
  version: z.number(),
  savedAt: z.string(),
  savedBy: auditActorSchema,
  reason: z.enum(['autosave', 'manual', 'signature', 'unsign', 'admin_fix', 'ai_import']),
  changedSectionIds: z.optional(z.array(z.string())),
  sectionSnapshots: z.optional(z.array(versionSectionSnapshotSchema)),
});
const pdfMetaSchema = z.object({
  fileId: z.optional(z.string()),
  webViewLink: z.optional(z.string()),
  folderPath: z.optional(z.string()),
  exportedAt: z.optional(z.string()),
  exportStatus: z.optional(z.enum(['pending', 'exported', 'failed'])),
  exportError: z.optional(z.string()),
});

export const clinicalDocumentRecordSchema = z.object({
  id: z.string(),
  schemaVersion: z.optional(z.number()),
  hospitalId: z.string(),
  documentType: clinicalDocumentTypeSchema,
  templateId: z.string(),
  templateVersion: z.number(),
  title: z.string(),
  patientInfoTitle: z.string(),
  footerMedicoLabel: z.string(),
  footerEspecialidadLabel: z.string(),
  patientRut: z.string(),
  patientName: z.string(),
  episodeKey: z.string(),
  admissionDate: z.optional(z.string()),
  sourceDailyRecordDate: z.optional(z.string()),
  sourceBedId: z.optional(z.string()),
  patientFields: z.array(patientFieldSchema),
  sections: z.array(clinicalDocumentSectionSchema),
  medico: z.string(),
  especialidad: z.string(),
  status: clinicalDocumentStatusSchema,
  isLocked: z.boolean(),
  lockedReason: z.optional(z.literal('episode_closed')),
  lockedAt: z.optional(z.string()),
  isActiveEpisodeDocument: z.boolean(),
  currentVersion: z.number(),
  versionHistory: z.array(versionHistorySchema),
  audit: z.object({
    createdAt: z.string(),
    createdBy: auditActorSchema,
    updatedAt: z.string(),
    updatedBy: auditActorSchema,
    signedAt: z.optional(z.string()),
    signedBy: z.optional(auditActorSchema),
    unsignedAt: z.optional(z.string()),
    unsignedBy: z.optional(auditActorSchema),
    signatureRevocations: z.optional(
      z.array(
        z.object({
          revokedAt: z.string(),
          revokedBy: auditActorSchema,
          previousSignedAt: z.optional(z.string()),
          reason: z.string(),
        })
      )
    ),
    archivedAt: z.optional(z.string()),
    archivedBy: z.optional(auditActorSchema),
  }),
  pdf: z.optional(pdfMetaSchema),
  renderedText: z.optional(z.string()),
  integrityHash: z.optional(z.string()),
  annexContent: z.optional(z.string()),
  annexIncludedInPrint: z.optional(z.boolean()),
  includePatientSignature: z.optional(z.boolean()),
  ieehDraft: z.optional(
    z.object({
      cie10Code: z.string(),
      cie10Description: z.string(),
      diagnosticoPrincipal: z.string(),
      condicionEgreso: z.enum(['1', '2', '3', '4', '5', '6', '7']),
      intervencionQuirurgica: z.enum(['1', '2']),
      intervencionQuirurgDescrip: z.optional(z.string()),
      intervencionCodigo: z.optional(z.string()),
      procedimiento: z.enum(['1', '2']),
      procedimientoDescrip: z.optional(z.string()),
      procedimientoCodigo: z.optional(z.string()),
      tratanteRut: z.optional(z.string()),
      tratanteNombreCompleto: z.optional(z.string()),
      tratanteEspecialidad: z.optional(z.string()),
    })
  ),
});

export const parseClinicalDocumentRecord = (record: unknown): ClinicalDocumentRecord =>
  clinicalDocumentRecordSchema.parse(record) as ClinicalDocumentRecord;
export const safeParseClinicalDocumentRecord = (record: unknown) =>
  clinicalDocumentRecordSchema.safeParse(record);
export const formatClinicalDocumentContractIssues = (
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>
): string[] =>
  issues.map(issue => `${issue.path.map(String).join('.') || 'root'}: ${issue.message}`);
