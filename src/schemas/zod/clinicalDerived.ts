import * as z from 'zod/mini';
import type { ClinicalDerivedEpisodeDoc } from '@/types/domain/clinicalDerived';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';
import {
  CLINICAL_DERIVED_DOC_SCHEMA_VERSION,
  CLINICAL_DERIVED_TARGETS,
} from '@/constants/clinicalDerived';
import { DATE_REGEX, StringSchema } from './helpers';
import { ClinicalSyncCheckpointSchema } from './patient';

/*
 * Only the episode reader and the backup restore (both loaded on demand) import this module. The
 * day marker is not validated here: the day schema keeps it as stored and the clinicalDerived
 * contract classifies it.
 */

// The day's embedded copy is not validated beyond this either: readers sort and show readings by
// these two keys and render whatever measurements each one carries.
const isVitalSignsReading = (value: unknown): value is PatientVitalSigns =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as Record<string, unknown>).recordedDate === 'string' &&
  typeof (value as Record<string, unknown>).recordedAt === 'string';

const VitalSignsHistorySchema = z.array(z.custom<PatientVitalSigns>(isVitalSignsReading));

/**
 * Server-written episode document. Moved fields are nullable without turning null into undefined:
 * a null field still wins over the embedded copy.
 */
export const ClinicalDerivedEpisodeDocSchema: z.ZodMiniType<ClinicalDerivedEpisodeDoc, unknown> =
  z.object({
    schemaVersion: z.literal(CLINICAL_DERIVED_DOC_SCHEMA_VERSION),
    date: StringSchema.check(z.regex(DATE_REGEX)),
    clinicalEpisodeId: StringSchema.check(z.minLength(1)),
    layoutGeneration: StringSchema.check(z.minLength(1)),
    target: z.optional(z.enum(CLINICAL_DERIVED_TARGETS)),
    bedId: z.optional(StringSchema),
    dayRevision: z.int().check(z.nonnegative()),
    updatedAt: z.optional(z.unknown()),
    lastMutationId: z.optional(z.nullable(StringSchema)),
    clinicalSyncCheckpoint: z.optional(z.nullable(ClinicalSyncCheckpointSchema)),
    vitalSignsHistory: z.optional(z.nullable(VitalSignsHistorySchema)),
  });
