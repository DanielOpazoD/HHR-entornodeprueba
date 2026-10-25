import * as z from 'zod';
import type { ClinicalDerivedEpisodeDoc } from '@/types/domain/clinicalDerived';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';
import {
  CLINICAL_DERIVED_DOC_SCHEMA_VERSION,
  CLINICAL_DERIVED_TARGETS,
} from '@/services/storage/clinicalDerivedConstants';
import { DATE_REGEX, StringSchema } from './helpers';
import { ClinicalSyncCheckpointSchema } from './patient';

/*
 * Only the episode reader and the backup restore (both loaded on demand) import this module. The
 * day marker is not validated here: the day schema keeps it as stored and the clinicalDerived
 * contract classifies it.
 */

// The day's embedded copy is not validated beyond this either: readers sort and show readings by
// these two keys and render whatever measurements each one carries.
const VitalSignsHistorySchema = z
  .array(z.object({ recordedDate: StringSchema, recordedAt: StringSchema }).passthrough())
  .transform(readings => readings as unknown as PatientVitalSigns[]);

/**
 * Server-written episode document. Moved fields are nullable without turning null into undefined:
 * a null field still wins over the embedded copy.
 */
export const ClinicalDerivedEpisodeDocSchema: z.ZodType<ClinicalDerivedEpisodeDoc, unknown> =
  z.object({
    schemaVersion: z.literal(CLINICAL_DERIVED_DOC_SCHEMA_VERSION),
    date: StringSchema.regex(DATE_REGEX),
    clinicalEpisodeId: StringSchema.min(1),
    layoutGeneration: StringSchema.min(1),
    target: z.enum(CLINICAL_DERIVED_TARGETS).optional(),
    bedId: StringSchema.optional(),
    dayRevision: z.number().int().nonnegative(),
    updatedAt: z.unknown().optional(),
    lastMutationId: StringSchema.nullable().optional(),
    clinicalSyncCheckpoint: ClinicalSyncCheckpointSchema.nullable().optional(),
    vitalSignsHistory: VitalSignsHistorySchema.nullable().optional(),
  });
