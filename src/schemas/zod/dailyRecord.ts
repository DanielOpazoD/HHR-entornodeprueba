import { z } from 'zod';
import { DailyRecord } from '@/types/domain/dailyRecord';
import {
  DATE_REGEX,
  nullableOptional,
  nullishDefault,
  StringSchema,
  OptionalStringSchema,
  NullableOptionalStringSchema,
  DefaultEmptyStringSchema,
} from './helpers';
import { BedTypeSchema, PatientDataSchema } from './patient';
import { DischargeDataSchema, TransferDataSchema, CMADataSchema } from './movements';
import { RayenSyncPerformanceSchema } from './rayenSyncPerformance';
import { applyDailyRecordStaffingCompatibility } from '@/services/staff/dailyRecordStaffing';
import {
  MAX_RAYEN_STAFFING_BOUNDARY_EVIDENCE,
  MAX_RAYEN_STRUCTURAL_REVIEW_ISSUES,
  RAYEN_SYNC_FAILURE_REASONS,
  RAYEN_SYNC_ISSUE_REASONS,
  RAYEN_SYNC_ISSUE_SOURCES,
} from '@/types/domain/rayenSync';

const MedicalHandoffActorSchema = z.object({
  uid: StringSchema,
  displayName: StringSchema,
  email: StringSchema,
  specialty: NullableOptionalStringSchema,
  role: NullableOptionalStringSchema,
});
const MedicalHandoffDailyContinuityEntrySchema = z.object({
  status: z.enum(['updated_by_specialist', 'confirmed_no_changes']),
  confirmedBy: nullableOptional(MedicalHandoffActorSchema),
  confirmedAt: NullableOptionalStringSchema,
  comment: NullableOptionalStringSchema,
});

const MedicalSpecialtyHandoffNoteSchema = z.object({
  note: DefaultEmptyStringSchema,
  createdAt: StringSchema,
  updatedAt: StringSchema,
  author: MedicalHandoffActorSchema,
  lastEditor: nullableOptional(MedicalHandoffActorSchema),
  version: z.number().default(1),
  dailyContinuity: nullableOptional(
    z.record(StringSchema, MedicalHandoffDailyContinuityEntrySchema)
  ),
});

const DetailedStaffAssignmentSchema = z.object({
  id: StringSchema,
  name: StringSchema,
  role: z.enum(['nurse', 'tens']),
  slotType: z.enum(['standard', 'extra']),
  standardSlotIndex: nullableOptional(z.number()),
  startTime: StringSchema,
  endTime: StringSchema,
});

const DailyRecordStaffingDetailsSchema = z.object({
  day: z.object({
    nurses: z.array(DetailedStaffAssignmentSchema).default([]),
    tens: z.array(DetailedStaffAssignmentSchema).default([]),
  }),
  night: z.object({
    nurses: z.array(DetailedStaffAssignmentSchema).default([]),
    tens: z.array(DetailedStaffAssignmentSchema).default([]),
  }),
});

const RayenSyncCoverageSchema = z.object({
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  sourceErrors: z.number().int().nonnegative(),
  issues: nullableOptional(
    z.array(
      z.object({
        bedId: StringSchema,
        source: z.enum(RAYEN_SYNC_ISSUE_SOURCES),
        reason: z.enum(RAYEN_SYNC_ISSUE_REASONS),
      })
    )
  ),
  incremental: nullableOptional(
    z.object({
      received: z.number().int().nonnegative(),
      newFacts: z.number().int().nonnegative(),
      duplicates: z.number().int().nonnegative(),
      corrections: z.number().int().nonnegative(),
      patientWrites: z.number().int().nonnegative(),
      historySnapshots: z.number().int().nonnegative(),
      clinicalTargets: nullableOptional(z.number().int().nonnegative()),
      checkpointOnlyTargets: nullableOptional(z.number().int().nonnegative()),
      batch: nullableOptional(
        z.object({
          mode: z.enum(['shadow', 'enforced']),
          parity: z.enum(['matched', 'mismatch', 'unavailable']),
          clinicalTargets: z.number().int().nonnegative(),
          checkpointOnlyTargets: z.number().int().nonnegative(),
          checkpointTargets: z.number().int().nonnegative(),
          requestedFields: z.number().int().nonnegative(),
          backendTargets: nullableOptional(z.number().int().nonnegative()),
          backendFields: nullableOptional(z.number().int().nonnegative()),
        })
      ),
    })
  ),
  completedAt: StringSchema,
});

const RayenSyncChangesSchema = z.object({
  admissions: z.number().int().nonnegative(),
  updates: z.number().int().nonnegative(),
  moves: z.number().int().nonnegative(),
  discharges: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
});

const RayenSyncSourceSchema = z.object({
  extensionVersion: NullableOptionalStringSchema,
  protocolVersion: nullableOptional(z.number().int().nonnegative()),
  fichaMedico: nullableOptional(z.enum(['ready', 'missing', 'stale'])),
  gestionCamas: nullableOptional(z.enum(['ready', 'missing', 'stale'])),
});

const RayenSyncStaffingObservationSchema = z.object({
  ambiguousSections: z.array(z.enum(['nurse_day', 'nurse_night', 'tens_day', 'tens_night'])),
  ignoredBoundaryRecords: z.number().int().nonnegative(),
  ignoredBoundaryEvidence: nullableOptional(
    z
      .array(
        z.object({
          section: z.enum(['nurse_day', 'nurse_night', 'tens_day', 'tens_night']),
          name: StringSchema,
          role: StringSchema,
          recordedAt: StringSchema,
          source: z.enum([
            'evolution',
            'shift-change',
            'evaluation-scale',
            'medication-administration',
            'vital-signs',
          ]),
          boundary: z.enum(['day_start', 'night_start', 'night_end']),
        })
      )
      .max(MAX_RAYEN_STAFFING_BOUNDARY_EVIDENCE)
  ),
});

const RayenSyncStructuralReviewSchema = z.object({
  structureConfirmed: nullableOptional(z.boolean()),
  snapshotComplete: nullableOptional(z.boolean()),
  historicalCorrectionsPending: z.boolean(),
  historicalCorrectionsRequireFreshCapture: z.boolean(),
  isolatedConflicts: z.number().int().nonnegative(),
  deferredHistoricalAdmissionBedIds: nullableOptional(
    z.array(StringSchema.min(1).max(32)).max(MAX_RAYEN_STRUCTURAL_REVIEW_ISSUES)
  ),
  issues: nullableOptional(
    z
      .array(
        z.object({
          // Legacy null normalization removes explicit nulls. A bed-less structural conflict
          // must still survive the daily-record read as a nullable, privacy-safe issue.
          bedId: StringSchema.nullable().default(null),
          caseContext: nullableOptional(
            z
              .object({
                patientName: StringSchema.min(1).max(240),
                censusDate: StringSchema.regex(DATE_REGEX),
                bedId: StringSchema.min(1).max(32),
                isClinicalCrib: z.boolean().optional(),
              })
              .optional()
              .catch(undefined)
          ),
          reason: z
            .enum([
              'unconfirmed-principal-bed',
              'principal-bed-collision',
              'cma-physical-bed-collision',
              'occupied-local-bed',
              'historical-reconstruction',
              'previous-census-continuity',
              'historical-admission-evidence',
              'unverified-report-row',
              'episode-less-report-row',
              'report-predates-admission',
              'crib-conflict-blocks-discharge',
              'unclassified',
            ])
            .catch('unclassified'),
        })
      )
      .max(MAX_RAYEN_STRUCTURAL_REVIEW_ISSUES)
  ),
});

export const RayenSyncEventSchema = z.object({
  id: StringSchema,
  sourceDate: nullableOptional(StringSchema.regex(DATE_REGEX)),
  startedAt: StringSchema,
  completedAt: NullableOptionalStringSchema,
  by: StringSchema,
  status: z.enum(['applied', 'complete', 'partial', 'failed']),
  coverage: nullableOptional(RayenSyncCoverageSchema),
  changes: nullableOptional(RayenSyncChangesSchema),
  source: nullableOptional(RayenSyncSourceSchema),
  policy: nullableOptional(
    z.object({
      mode: z.enum(['preview', 'auto']),
      clinicalBatchMode: nullableOptional(z.enum(['off', 'shadow', 'enforced'])),
      revision: z.number().int().nonnegative(),
    })
  ),
  // `.catch`: a requirement written by a newer client must not invalidate the whole event; the
  // record survives without the reason, exactly like `failureReason`.
  reviewRequirement: nullableOptional(z.enum(['day_bootstrap']).optional().catch(undefined)),
  staffingObservation: nullableOptional(RayenSyncStaffingObservationSchema),
  structuralReview: nullableOptional(RayenSyncStructuralReviewSchema),
  performance: nullableOptional(RayenSyncPerformanceSchema),
  // Derivado de la tupla de dominio (una sola lista). `.catch`: una causa que
  // este cliente aún no conoce (escrita por una versión más nueva) no puede
  // invalidar el registro completo; el evento sobrevive sin causa.
  failureReason: nullableOptional(z.enum(RAYEN_SYNC_FAILURE_REASONS).optional().catch(undefined)),
});

export const RayenSyncMetaSchema = z.object({
  at: StringSchema,
  by: StringSchema,
  runId: NullableOptionalStringSchema,
  status: nullableOptional(z.enum(['applied', 'complete', 'partial'])),
  coverage: nullableOptional(RayenSyncCoverageSchema),
  changes: nullableOptional(RayenSyncChangesSchema),
  source: nullableOptional(RayenSyncSourceSchema),
  staffingObservation: nullableOptional(RayenSyncStaffingObservationSchema),
});

export const RayenBedCollisionResolutionReceiptSchema = z.object({
  id: StringSchema,
  selectedEpisodeId: StringSchema,
  otherEpisodeId: StringSchema,
  otherDisposition: z.union([
    z.object({ kind: z.literal('move'), targetBedId: StringSchema }),
    z.object({ kind: z.enum(['discharge', 'transfer', 'remove']) }),
  ]),
});

export const DailyRecordSchema: z.ZodType<DailyRecord, z.ZodTypeDef, unknown> = z.preprocess(
  input => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return input;
    }

    return applyDailyRecordStaffingCompatibility(
      input as Pick<DailyRecord, 'nurses' | 'nurseName' | 'nursesDayShift' | 'nursesNightShift'>
    );
  },
  z
    .object({
      date: StringSchema.regex(DATE_REGEX),
      beds: z.record(StringSchema, PatientDataSchema).default({}),
      bedTypeOverrides: z
        .preprocess(
          val => {
            if (!val || typeof val !== 'object') return {};
            const record: Record<string, unknown> = { ...(val as Record<string, unknown>) };
            // Filter out null/undefined values which might come from Firestore deletes or reverts
            Object.keys(record).forEach(key => {
              if (record[key] === null || record[key] === undefined) delete record[key];
            });
            return record;
          },
          z.record(StringSchema, BedTypeSchema)
        )
        .default({}),
      discharges: nullishDefault(z.array(DischargeDataSchema), () => []),
      transfers: nullishDefault(z.array(TransferDataSchema), () => []),
      cma: nullishDefault(z.array(CMADataSchema), () => []),
      lastUpdated: StringSchema.default(() => new Date().toISOString()),
      rayenSync: nullableOptional(RayenSyncMetaSchema),
      rayenSyncHistory: nullableOptional(z.array(RayenSyncEventSchema)),
      rayenBedCollisionResolutions: nullableOptional(
        z.array(RayenBedCollisionResolutionReceiptSchema)
      ),
      dateTimestamp: nullableOptional(z.number()),
      schemaVersion: z.number().default(1),
      nurses: nullishDefault(z.array(StringSchema), () => ['', '']),
      nurseName: NullableOptionalStringSchema,
      nursesDayShift: nullishDefault(z.array(StringSchema), () => ['', '']),
      nursesNightShift: nullishDefault(z.array(StringSchema), () => ['', '']),
      tensDayShift: nullishDefault(z.array(StringSchema), () => ['', '', '']),
      tensNightShift: nullishDefault(z.array(StringSchema), () => ['', '', '']),
      staffingDetailsV1: nullableOptional(DailyRecordStaffingDetailsSchema),
      activeExtraBeds: nullishDefault(z.array(StringSchema), () => []),
      handoffDayChecklist: z
        .object({
          escalaBraden: nullableOptional(z.boolean()),
          escalaRiesgoCaidas: nullableOptional(z.boolean()),
          escalaRiesgoLPP: nullableOptional(z.boolean()),
        })
        .default({}),
      handoffNightChecklist: z
        .object({
          estadistica: nullableOptional(z.boolean()),
          categorizacionCudyr: nullableOptional(z.boolean()),
          encuestaUTI: nullableOptional(z.boolean()),
          encuestaMedias: nullableOptional(z.boolean()),
          conteoMedicamento: nullableOptional(z.boolean()),
          conteoNoControlados: nullableOptional(z.boolean()),
          conteoNoControladosProximaFecha: NullableOptionalStringSchema,
        })
        .default({}),
      handoffNovedadesDayShift: NullableOptionalStringSchema,
      handoffNovedadesNightShift: NullableOptionalStringSchema,
      medicalHandoffNovedades: NullableOptionalStringSchema,
      medicalHandoffBySpecialty: nullableOptional(
        z.record(StringSchema, MedicalSpecialtyHandoffNoteSchema)
      ),
      medicalHandoffDoctor: NullableOptionalStringSchema,
      medicalHandoffSentAt: NullableOptionalStringSchema,
      medicalHandoffSentAtByScope: nullableOptional(
        z.object({
          all: NullableOptionalStringSchema,
          upc: NullableOptionalStringSchema,
          'no-upc': NullableOptionalStringSchema,
        })
      ),
      medicalSignatureLinkTokenByScope: nullableOptional(
        z.object({
          all: NullableOptionalStringSchema,
          upc: NullableOptionalStringSchema,
          'no-upc': NullableOptionalStringSchema,
        })
      ),
      medicalSignature: nullableOptional(
        z.object({
          doctorName: StringSchema,
          signedAt: StringSchema,
          userAgent: NullableOptionalStringSchema,
        })
      ),
      medicalSignatureByScope: nullableOptional(
        z.object({
          all: nullableOptional(
            z.object({
              doctorName: StringSchema,
              signedAt: StringSchema,
              userAgent: NullableOptionalStringSchema,
            })
          ),
          upc: nullableOptional(
            z.object({
              doctorName: StringSchema,
              signedAt: StringSchema,
              userAgent: NullableOptionalStringSchema,
            })
          ),
          'no-upc': nullableOptional(
            z.object({
              doctorName: StringSchema,
              signedAt: StringSchema,
              userAgent: NullableOptionalStringSchema,
            })
          ),
        })
      ),
      cudyrLocked: nullableOptional(z.boolean()),
      cudyrLockedAt: NullableOptionalStringSchema,
      cudyrLockedBy: NullableOptionalStringSchema,
      cudyrUpdatedAt: NullableOptionalStringSchema,
      cudyrUpdatedBy: NullableOptionalStringSchema,
      cudyrUpdatedById: NullableOptionalStringSchema,
      cudyrShiftDate: NullableOptionalStringSchema,
      cudyrCompletedAt: NullableOptionalStringSchema,
      cudyrCompletedBy: NullableOptionalStringSchema,
      handoffNightReceives: nullishDefault(z.array(StringSchema), () => []),
    })
    .passthrough()
);

/**
 * Full backup schema for import/export
 */
export const FullBackupSchema = z.record(StringSchema, DailyRecordSchema);
