import { z } from 'zod';

const clinicalAttachmentActorSchema = z.object({
  uid: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: z.string(),
});

const clinicalAttachmentImageMetaSchema = z.object({
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  compressed: z.boolean(),
  originalSizeBytes: z.number().nonnegative().optional(),
  compressionQuality: z.number().min(0).max(1).optional(),
});

export const clinicalAttachmentRecordSchema = z.object({
  id: z.string().min(1),
  hospitalId: z.string().min(1),
  patientRut: z.string().min(1),
  patientRutKey: z.string().min(1),
  patientName: z.string().optional(),
  episodeKey: z.string().min(1),
  admissionDate: z.string().optional(),
  sourceDailyRecordDate: z.string().optional(),
  bedId: z.string().optional(),
  documentId: z.string().optional(),
  documentType: z
    .enum(['epicrisis', 'evolucion', 'informe_medico', 'epicrisis_traslado', 'otro'])
    .optional(),
  sectionId: z.string().optional(),
  storagePath: z.string().min(1),
  downloadUrl: z.string().optional(),
  originalFileName: z.string().min(1),
  displayName: z.string().min(1),
  contentType: z.string().min(1),
  fileKind: z.enum(['image', 'pdf', 'docx', 'other']),
  sizeBytes: z.number().nonnegative(),
  image: clinicalAttachmentImageMetaSchema.optional(),
  status: z.enum(['active', 'deleted', 'upload_failed']),
  createdAt: z.string().min(1),
  createdBy: clinicalAttachmentActorSchema,
  updatedAt: z.string().min(1),
  updatedBy: clinicalAttachmentActorSchema,
  deletedAt: z.string().optional(),
  deletedBy: clinicalAttachmentActorSchema.optional(),
});

export type ClinicalAttachmentRecordContract = z.infer<typeof clinicalAttachmentRecordSchema>;

export const parseClinicalAttachmentRecord = (value: unknown): ClinicalAttachmentRecordContract =>
  clinicalAttachmentRecordSchema.parse(value);

export const safeParseClinicalAttachmentRecord = (value: unknown) =>
  clinicalAttachmentRecordSchema.safeParse(value);
