import { z } from 'zod';
import type {
  ClinicalDerivedEpisodeDoc,
  ClinicalDerivedLayout,
} from '@/types/domain/clinicalDerived';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';
import { DATE_REGEX, StringSchema } from './helpers';
import { ClinicalSyncCheckpointSchema } from './patient';

/**
 * Day marker as stored. Any integer version passes, and unknown keys are kept, so a client never
 * drops or rewrites a marker it does not understand; the contract decides which versions it reads.
 */
export const ClinicalDerivedLayoutSchema: z.ZodType<ClinicalDerivedLayout, z.ZodTypeDef, unknown> =
  z
    .object({
      version: z.number().int(),
      generation: StringSchema.min(1),
    })
    .passthrough();

// The day's embedded copy is not validated beyond this either: readers sort and show readings by
// these two keys and render whatever measurements each one carries.
const VitalSignsHistorySchema = z
  .array(z.object({ recordedDate: StringSchema, recordedAt: StringSchema }).passthrough())
  .transform(readings => readings as unknown as PatientVitalSigns[]);

/**
 * Server-written episode document. Moved fields are nullable without turning null into undefined:
 * a null field still wins over the embedded copy.
 */
export const ClinicalDerivedEpisodeDocSchema: z.ZodType<
  ClinicalDerivedEpisodeDoc,
  z.ZodTypeDef,
  unknown
> = z.object({
  schemaVersion: z.literal(1),
  date: StringSchema.regex(DATE_REGEX),
  clinicalEpisodeId: StringSchema.min(1),
  layoutGeneration: StringSchema.min(1),
  target: z.enum(['bed', 'clinicalCrib']).optional(),
  bedId: StringSchema.optional(),
  dayRevision: z.number().int().nonnegative(),
  updatedAt: z.unknown().optional(),
  lastMutationId: StringSchema.nullable().optional(),
  clinicalSyncCheckpoint: ClinicalSyncCheckpointSchema.nullable().optional(),
  vitalSignsHistory: VitalSignsHistorySchema.nullable().optional(),
});
