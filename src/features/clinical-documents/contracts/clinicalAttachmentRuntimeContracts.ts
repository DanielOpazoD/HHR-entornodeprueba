import * as z from 'zod/mini';

const clinicalAttachmentActorSchema = z.object({
  uid: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: z.string(),
});

const clinicalAttachmentImageMetaSchema = z.object({
  width: z.optional(z.number().check(z.positive())),
  height: z.optional(z.number().check(z.positive())),
  compressed: z.boolean(),
  originalSizeBytes: z.optional(z.number().check(z.nonnegative())),
  compressionQuality: z.optional(z.number().check(z.minimum(0), z.maximum(1))),
});

export const clinicalAttachmentRecordSchema = z.object({
  id: z.string().check(z.minLength(1)),
  hospitalId: z.string().check(z.minLength(1)),
  patientRut: z.string().check(z.minLength(1)),
  patientRutKey: z.string().check(z.minLength(1)),
  patientName: z.optional(z.string()),
  episodeKey: z.string().check(z.minLength(1)),
  admissionDate: z.optional(z.string()),
  sourceDailyRecordDate: z.optional(z.string()),
  bedId: z.optional(z.string()),
  documentId: z.optional(z.string()),
  documentType: z.optional(
    z.enum(['epicrisis', 'evolucion', 'informe_medico', 'epicrisis_traslado', 'otro'])
  ),
  sectionId: z.optional(z.string()),
  storagePath: z.string().check(z.minLength(1)),
  downloadUrl: z.optional(z.string()),
  originalFileName: z.string().check(z.minLength(1)),
  displayName: z.string().check(z.minLength(1)),
  contentType: z.string().check(z.minLength(1)),
  fileKind: z.enum(['image', 'pdf', 'docx', 'other']),
  sizeBytes: z.number().check(z.nonnegative()),
  image: z.optional(clinicalAttachmentImageMetaSchema),
  status: z.enum(['active', 'deleted', 'upload_failed']),
  createdAt: z.string().check(z.minLength(1)),
  createdBy: clinicalAttachmentActorSchema,
  updatedAt: z.string().check(z.minLength(1)),
  updatedBy: clinicalAttachmentActorSchema,
  deletedAt: z.optional(z.string()),
  deletedBy: z.optional(clinicalAttachmentActorSchema),
});

export type ClinicalAttachmentRecordContract = z.infer<typeof clinicalAttachmentRecordSchema>;

export const parseClinicalAttachmentRecord = (value: unknown): ClinicalAttachmentRecordContract =>
  clinicalAttachmentRecordSchema.parse(value);

export const safeParseClinicalAttachmentRecord = (value: unknown) =>
  clinicalAttachmentRecordSchema.safeParse(value);
