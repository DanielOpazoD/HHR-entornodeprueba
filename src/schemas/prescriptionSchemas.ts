/**
 * Prescription Runtime Contracts
 *
 * Zod schemas mirroring the domain types in `prescriptionTypes.ts`. Used at
 * Firestore read boundaries and inside Cloud Functions to reject malformed
 * documents instead of letting them flow into the visor unparsed.
 */

import { z } from 'zod';

import {
  PRESCRIPTION_ASSIGNMENT_SCOPES,
  PRESCRIPTION_TYPES,
  type PrescriptionRecord,
} from '@/types/prescriptionTypes';

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
  storagePath: z.string().min(1),
  thumbnailStoragePath: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  contentType: z.literal('image/jpeg'),
});

const prescriptionUploaderRefSchema = z.object({
  uid: z.string().optional(),
  email: z.string().optional(),
  source: z.enum(['authenticated', 'qr_pin']),
  displayName: z.string().optional(),
});

const optionalFirestoreStringSchema = z.preprocess(
  value => (value === null ? undefined : value),
  z.string().optional()
);

export const prescriptionRecordSchema = z.object({
  id: z.string().min(1),
  hospitalId: z.string().min(1),
  prescriptionType: prescriptionTypeSchema,
  assignmentScope: prescriptionAssignmentScopeSchema.optional(),
  bedId: optionalFirestoreStringSchema,
  patientName: optionalFirestoreStringSchema,
  patientRut: optionalFirestoreStringSchema,
  notes: optionalFirestoreStringSchema,
  image: prescriptionImageMetaSchema,
  uploader: prescriptionUploaderRefSchema,
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
  patientReassignedAt: z.string().optional(),
  patientReassignedBy: z.string().optional(),
  typeUpdatedAt: z.string().optional(),
  typeUpdatedBy: z.string().optional(),
});

const legacyCompatiblePrescriptionRecordSchema = prescriptionRecordSchema.extend({
  image: prescriptionImageMetaSchema.extend({
    // Legacy uploads may still point to PNG/WebP assets created before JPEG normalization.
    contentType: z.string().min(1),
  }),
  uploader: prescriptionUploaderRefSchema.extend({
    // Legacy records persisted before `source` rollout.
    source: z.enum(['authenticated', 'qr_pin']).optional(),
  }),
});

export type ParsedPrescriptionRecord = z.infer<typeof prescriptionRecordSchema>;

/**
 * Strict parse: throws on invalid input. Use only when the caller knows
 * the data should already be valid (e.g., after a write).
 */
export const parsePrescriptionRecord = (input: unknown): PrescriptionRecord =>
  prescriptionRecordSchema.parse(input) as PrescriptionRecord;

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
