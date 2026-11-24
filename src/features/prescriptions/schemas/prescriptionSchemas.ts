/**
 * Prescription Runtime Contracts
 *
 * Zod schemas mirroring the domain types in `prescriptionTypes.ts`. Used at
 * Firestore read boundaries and inside Cloud Functions to reject malformed
 * documents instead of letting them flow into the visor unparsed.
 */

import * as z from 'zod/mini';

import {
  PRESCRIPTION_ASSIGNMENT_SCOPES,
  PRESCRIPTION_TYPES,
  type PrescriptionRecord,
} from '@/features/prescriptions/types/prescriptionTypes';

const prescriptionTypeSchema = z.enum(
  PRESCRIPTION_TYPES as readonly [string, ...string[]] as readonly [
    'comun',
    'psicotropicos',
    'benzodiazepinas',
  ]
);

const prescriptionAssignmentScopeSchema = z.enum(
  PRESCRIPTION_ASSIGNMENT_SCOPES as readonly [string, ...string[]] as readonly [
    'patient',
    'unassigned',
    'hospitalized_stock',
  ]
);

const prescriptionImageMetaSchema = z.object({
  storagePath: z.string().check(z.minLength(1)),
  thumbnailStoragePath: z.string().check(z.minLength(1)),
  byteSize: z.int().check(z.nonnegative()),
  width: z.int().check(z.positive()),
  height: z.int().check(z.positive()),
  contentType: z.literal('image/jpeg'),
});

const prescriptionUploaderRefSchema = z.object({
  uid: z.optional(z.string()),
  email: z.optional(z.string()),
  source: z.enum(['authenticated', 'qr_pin']),
  displayName: z.optional(z.string()),
});

const optionalFirestoreStringSchema = z.pipe(
  z.transform(value => (value === null ? undefined : value)),
  z.optional(z.string())
);

export const prescriptionRecordSchema = z.object({
  id: z.string().check(z.minLength(1)),
  hospitalId: z.string().check(z.minLength(1)),
  prescriptionType: prescriptionTypeSchema,
  assignmentScope: z.optional(prescriptionAssignmentScopeSchema),
  bedId: optionalFirestoreStringSchema,
  patientName: optionalFirestoreStringSchema,
  patientRut: optionalFirestoreStringSchema,
  notes: optionalFirestoreStringSchema,
  image: prescriptionImageMetaSchema,
  uploader: prescriptionUploaderRefSchema,
  createdAt: z.string().check(z.minLength(1)),
  expiresAt: z.string().check(z.minLength(1)),
  patientReassignedAt: z.optional(z.string()),
  patientReassignedBy: z.optional(z.string()),
  typeUpdatedAt: z.optional(z.string()),
  typeUpdatedBy: z.optional(z.string()),
});

const legacyCompatiblePrescriptionRecordSchema = z.extend(prescriptionRecordSchema, {
  image: z.extend(prescriptionImageMetaSchema, {
    // Legacy uploads may still point to PNG/WebP assets created before JPEG normalization.
    contentType: z.string().check(z.minLength(1)),
  }),
  uploader: z.extend(prescriptionUploaderRefSchema, {
    // Legacy records persisted before `source` rollout.
    source: z.optional(z.enum(['authenticated', 'qr_pin'])),
  }),
});

/**
 * Lenient parse: returns the parsed record on success or `null` when the
 * input fails validation. Used at the Firestore read boundary so a single
 * corrupt document doesn't blow up the listing for the rest.
 */
export const safeParsePrescriptionRecord = (input: unknown): PrescriptionRecord | null => {
  const strict = prescriptionRecordSchema.safeParse(input);
  if (strict.success) return strict.data as PrescriptionRecord;

  const legacy = legacyCompatiblePrescriptionRecordSchema.safeParse(input);
  if (!legacy.success) return null;

  return {
    ...(legacy.data as PrescriptionRecord),
    image: {
      ...legacy.data.image,
      // Keep runtime contract stable for UI consumers while tolerating legacy metadata.
      contentType: 'image/jpeg',
    },
    uploader: {
      ...legacy.data.uploader,
      source: legacy.data.uploader.source ?? 'authenticated',
    },
  } as PrescriptionRecord;
};
