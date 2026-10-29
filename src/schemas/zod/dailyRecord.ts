import { RayenSyncDiagnosticContextSchema } from './rayenSyncDiagnosticContext';
import * as z from 'zod';
import { DailyRecord } from '@/types/domain/dailyRecord';
import {
  DATE_REGEX,
  nullableOptional,
  nullishDefault,
  StringSchema,
  NullableOptionalStringSchema,
  DefaultEmptyStringSchema,
} from './helpers';
import { BedTypeSchema, PatientDataSchema } from './patient';
import { DischargeDataSchema, TransferDataSchema, CMADataSchema } from './movements';
import { RayenSyncPerformanceSchema } from './rayenSyncPerformance';
import { applyDailyRecordStaffingCompatibility } from '@/services/staff/dailyRecordStaffing';
import {
  CUDYR_RECOVERY_KINDS,
  MAX_RAYEN_STAFFING_BOUNDARY_EVIDENCE,
  MAX_RAYEN_STRUCTURAL_REVIEW_ISSUES,
  RAYEN_SYNC_FAILURE_REASONS,
  RAYEN_SYNC_ISSUE_REASONS,
  RAYEN_SYNC_ISSUE_SOURCES,
} from '@/types/domain/rayenSync';

const NonNegativeIntegerSchema = z.number().int().nonnegative();
const OptionalBooleanSchema = nullableOptional(z.boolean());
const OptionalNonNegativeIntegerSchema = nullableOptional(NonNegativeIntegerSchema);
const StringArraySchema = z.array(StringSchema);
const TwoStaffSlotsSchema = nullishDefault(StringArraySchema, () => ['', '']);
const ThreeStaffSlotsSchema = nullishDefault(StringArraySchema, () => ['', '', '']);
const EmptyStringArraySchema = nullishDefault(StringArraySchema, () => []);

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
  version: z.number().prefault(1),
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
const StaffAssignmentsSchema = z.array(DetailedStaffAssignmentSchema).prefault([]);

const DailyRecordStaffingDetailsSchema = z.object({
  day: z.object({
    nurses: StaffAssignmentsSchema,
    tens: StaffAssignmentsSchema,
  }),
  night: z.object({
    nurses: StaffAssignmentsSchema,
    tens: StaffAssignmentsSchema,
  }),
});

const RayenSyncCoverageSchema = z.object({
  total: NonNegativeIntegerSchema,
  completed: NonNegativeIntegerSchema,
  errors: NonNegativeIntegerSchema,
  sourceErrors: NonNegativeIntegerSchema,
  issues: nullableOptional(
    z.array(
      z.object({
        bedId: StringSchema,
        diagnostic: RayenSyncDiagnosticContextSchema,
        source: z.enum(RAYEN_SYNC_ISSUE_SOURCES),
        reason: z.enum(RAYEN_SYNC_ISSUE_REASONS),
        cudyrRecovery: z
          .object({
            kind: z.enum(CUDYR_RECOVERY_KINDS),
            targetDate: z.iso.date().nullable(),
          })
          .optional()
          .catch(undefined),
      })
    )
  ),
  incremental: nullableOptional(
    z.object({
      received: NonNegativeIntegerSchema,
      newFacts: NonNegativeIntegerSchema,
      duplicates: NonNegativeIntegerSchema,
      corrections: NonNegativeIntegerSchema,
      patientWrites: NonNegativeIntegerSchema,
      historySnapshots: NonNegativeIntegerSchema,
      clinicalTargets: OptionalNonNegativeIntegerSchema,
      checkpointOnlyTargets: OptionalNonNegativeIntegerSchema,
      batch: nullableOptional(
        z.object({
          mode: z.enum(['shadow', 'enforced']),
          parity: z.enum(['matched', 'mismatch', 'unavailable']),
          clinicalTargets: NonNegativeIntegerSchema,
          checkpointOnlyTargets: NonNegativeIntegerSchema,
          checkpointTargets: NonNegativeIntegerSchema,
          requestedFields: NonNegativeIntegerSchema,
          backendTargets: OptionalNonNegativeIntegerSchema,
          backendFields: OptionalNonNegativeIntegerSchema,
        })
      ),
    })
  ),
  completedAt: StringSchema,
});

const RayenSyncChangesSchema = z.object({
  admissions: NonNegativeIntegerSchema,
  updates: NonNegativeIntegerSchema,
  moves: NonNegativeIntegerSchema,
  discharges: NonNegativeIntegerSchema,
  unchanged: NonNegativeIntegerSchema,
});

const RayenSyncSourceSchema = z.object({
  extensionVersion: NullableOptionalStringSchema,
  protocolVersion: OptionalNonNegativeIntegerSchema,
  fichaMedico: nullableOptional(z.enum(['ready', 'missing', 'stale'])),
  gestionCamas: nullableOptional(z.enum(['ready', 'missing', 'stale'])),
});

const RayenSyncStaffingObservationSchema = z.object({
  ambiguousSections: z.array(z.enum(['nurse_day', 'nurse_night', 'tens_day', 'tens_night'])),
  ignoredBoundaryRecords: NonNegativeIntegerSchema,
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
  structureConfirmed: OptionalBooleanSchema,
  snapshotComplete: OptionalBooleanSchema,
  historicalCorrectionsPending: z.boolean(),
  historicalCorrectionsRequireFreshCapture: z.boolean(),
  isolatedConflicts: NonNegativeIntegerSchema,
  deferredHistoricalAdmissionBedIds: nullableOptional(
    z.array(StringSchema.min(1).max(32)).max(MAX_RAYEN_STRUCTURAL_REVIEW_ISSUES)
  ),
  issues: nullableOptional(
    z
      .array(
        z.object({
          // Legacy null normalization removes explicit nulls. A bed-less structural conflict
          // must still survive the daily-record read as a nullable, privacy-safe issue.
          bedId: StringSchema.nullable().prefault(null),
          diagnostic: RayenSyncDiagnosticContextSchema,
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
              'admission-date-policy',
              'structural-write-rejected',
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
      revision: NonNegativeIntegerSchema,
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

export const DailyRecordSchema: z.ZodType<DailyRecord, unknown> = z.preprocess(
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
      beds: z.record(StringSchema, PatientDataSchema).prefault({}),
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
        .prefault({}),
      discharges: nullishDefault(z.array(DischargeDataSchema), () => []),
      transfers: nullishDefault(z.array(TransferDataSchema), () => []),
      cma: nullishDefault(z.array(CMADataSchema), () => []),
      lastUpdated: StringSchema.prefault(() => new Date().toISOString()),
      rayenSync: nullableOptional(RayenSyncMetaSchema),
      rayenSyncHistory: nullableOptional(z.array(RayenSyncEventSchema)),
      rayenBedCollisionResolutions: nullableOptional(
        z.array(RayenBedCollisionResolutionReceiptSchema)
      ),
      // Kept as stored, whatever its shape: the clinicalDerived contract decides whether the day
      // is marked, unmarked or unsupported, so a marker this client does not understand is never
      // dropped (and never sends the whole day to the salvage path).
      clinicalDerivedLayout: nullableOptional(z.unknown()),
      dateTimestamp: nullableOptional(z.number()),
      schemaVersion: z.number().prefault(1),
      nurses: TwoStaffSlotsSchema,
      nurseName: NullableOptionalStringSchema,
      nursesDayShift: TwoStaffSlotsSchema,
      nursesNightShift: TwoStaffSlotsSchema,
      tensDayShift: ThreeStaffSlotsSchema,
      tensNightShift: ThreeStaffSlotsSchema,
      staffingDetailsV1: nullableOptional(DailyRecordStaffingDetailsSchema),
      activeExtraBeds: EmptyStringArraySchema,
      handoffDayChecklist: z
        .object({
          escalaBraden: OptionalBooleanSchema,
          escalaRiesgoCaidas: OptionalBooleanSchema,
          escalaRiesgoLPP: OptionalBooleanSchema,
        })
        .prefault({}),
      handoffNightChecklist: z
        .object({
          estadistica: OptionalBooleanSchema,
          categorizacionCudyr: OptionalBooleanSchema,
          encuestaUTI: OptionalBooleanSchema,
          encuestaMedias: OptionalBooleanSchema,
          conteoMedicamento: OptionalBooleanSchema,
          conteoNoControlados: OptionalBooleanSchema,
          conteoNoControladosProximaFecha: NullableOptionalStringSchema,
        })
        .prefault({}),
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
      cudyrLocked: OptionalBooleanSchema,
      cudyrLockedAt: NullableOptionalStringSchema,
      cudyrLockedBy: NullableOptionalStringSchema,
      cudyrUpdatedAt: NullableOptionalStringSchema,
      cudyrUpdatedBy: NullableOptionalStringSchema,
      cudyrUpdatedById: NullableOptionalStringSchema,
      cudyrShiftDate: NullableOptionalStringSchema,
      cudyrCompletedAt: NullableOptionalStringSchema,
      cudyrCompletedBy: NullableOptionalStringSchema,
      handoffNightReceives: EmptyStringArraySchema,
    })
    .passthrough()
);

/**
 * Full backup schema for import/export
 */
export const FullBackupSchema = z.record(StringSchema, DailyRecordSchema);
