import { isValidCrashCartReviewDate } from '@/domain/handoff/sharedChecklist';
import * as z from 'zod/mini';
import { DailyRecord } from '@/types/domain/dailyRecord';
import {
  DATE_REGEX,
  nullableOptional,
  nullishDefault,
  preprocess,
  StringSchema,
  NullableOptionalStringSchema,
  DefaultEmptyStringSchema,
} from './helpers';
import { BedTypeSchema, PatientDataSchema } from './patient';
import { DischargeDataSchema, TransferDataSchema, CMADataSchema } from './movements';
import { RayenSyncPerformanceSchema } from './rayenSyncPerformance';
import { applyDailyRecordStaffingCompatibility } from '@/domain/staff/dailyRecordStaffingCompatibility';
import {
  CUDYR_RECOVERY_KINDS,
  MAX_RAYEN_STAFFING_BOUNDARY_EVIDENCE,
  MAX_RAYEN_STRUCTURAL_REVIEW_ISSUES,
  RAYEN_SYNC_FAILURE_REASONS,
  CLINICAL_READ_ERROR_CODES,
  RAYEN_SYNC_ISSUE_REASONS,
  RAYEN_SYNC_ISSUE_SOURCES,
} from '@/types/domain/rayenSync';

export const HandoffSharedChecklistSchema = z.object({
  crashCartReviewDate: nullableOptional(z.string().check(z.refine(isValidCrashCartReviewDate))),
  crashCartCode: nullableOptional(z.string().check(z.regex(/^(?:[0-9]{8})?$/))),
});

const RayenSyncDiagnosticContextSchema = z.catch(
  z.optional(
    z.object({
      patientName: z.optional(z.string().check(z.maxLength(240))),
      document: z.optional(z.string().check(z.maxLength(80))),
      clinicalEpisodeId: z.optional(z.string().check(z.maxLength(100))),
      bedId: z.optional(z.string().check(z.maxLength(80))),
      censusDate: z.optional(z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/))),
      detail: z.optional(z.string().check(z.maxLength(1500))),
      sourceTimestamp: z.optional(z.string().check(z.maxLength(100))),
      sourceClinicalDay: z.optional(z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/))),
      sourceClinicalTime: z.optional(z.string().check(z.regex(/^\d{2}:\d{2}$/))),
      source: z.optional(z.string().check(z.maxLength(100))),
    })
  ),
  undefined
);

const NonNegativeIntegerSchema = z.int().check(z.nonnegative());
const OptionalBooleanSchema = nullableOptional(z.boolean());
const OptionalNonNegativeIntegerSchema = nullableOptional(NonNegativeIntegerSchema);
const StringArraySchema = z.array(StringSchema);
const TwoStaffSlotsSchema = nullishDefault(StringArraySchema, () => ['', '']);
const ThreeStaffSlotsSchema = nullishDefault(StringArraySchema, () => ['', '', '']);
const EmptyStringArraySchema = nullishDefault(StringArraySchema, () => []);
const OptionalMedicalSignatureSchema = nullableOptional(
  z.object({
    doctorName: StringSchema,
    signedAt: StringSchema,
    userAgent: NullableOptionalStringSchema,
  })
);
const OptionalMedicalHandoffScopesSchema = nullableOptional(
  z.object({
    all: NullableOptionalStringSchema,
    upc: NullableOptionalStringSchema,
    'no-upc': NullableOptionalStringSchema,
  })
);

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
  version: z.prefault(z.number(), 1),
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
const StaffAssignmentsSchema = z.prefault(z.array(DetailedStaffAssignmentSchema), []);

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
        cause: z.catch(z.optional(z.enum(CLINICAL_READ_ERROR_CODES)), undefined),
        cudyrRecovery: z.catch(
          z.optional(
            z.object({
              kind: z.enum(CUDYR_RECOVERY_KINDS),
              targetDate: z.nullable(z.iso.date()),
            })
          ),
          undefined
        ),
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
      .check(z.maxLength(MAX_RAYEN_STAFFING_BOUNDARY_EVIDENCE))
  ),
});

const RayenSyncStructuralReviewSchema = z.object({
  structureConfirmed: OptionalBooleanSchema,
  snapshotComplete: OptionalBooleanSchema,
  historicalCorrectionsPending: z.boolean(),
  historicalCorrectionsRequireFreshCapture: z.boolean(),
  isolatedConflicts: NonNegativeIntegerSchema,
  deferredHistoricalAdmissionBedIds: nullableOptional(
    z
      .array(StringSchema.check(z.minLength(1), z.maxLength(32)))
      .check(z.maxLength(MAX_RAYEN_STRUCTURAL_REVIEW_ISSUES))
  ),
  issues: nullableOptional(
    z
      .array(
        z.object({
          // Legacy null normalization removes explicit nulls. A bed-less structural conflict
          // must still survive the daily-record read as a nullable, privacy-safe issue.
          bedId: z.prefault(z.nullable(StringSchema), null),
          diagnostic: RayenSyncDiagnosticContextSchema,
          caseContext: nullableOptional(
            z.catch(
              z.optional(
                z.object({
                  patientName: StringSchema.check(z.minLength(1), z.maxLength(240)),
                  censusDate: StringSchema.check(z.regex(DATE_REGEX)),
                  bedId: StringSchema.check(z.minLength(1), z.maxLength(32)),
                  isClinicalCrib: z.optional(z.boolean()),
                })
              ),
              undefined
            )
          ),
          reason: z.catch(
            z.enum([
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
            ]),
            'unclassified'
          ),
        })
      )
      .check(z.maxLength(MAX_RAYEN_STRUCTURAL_REVIEW_ISSUES))
  ),
});

export const RayenSyncEventSchema = z.object({
  id: StringSchema,
  sourceDate: nullableOptional(StringSchema.check(z.regex(DATE_REGEX))),
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
  reviewRequirement: nullableOptional(z.catch(z.optional(z.enum(['day_bootstrap'])), undefined)),
  staffingObservation: nullableOptional(RayenSyncStaffingObservationSchema),
  structuralReview: nullableOptional(RayenSyncStructuralReviewSchema),
  performance: nullableOptional(RayenSyncPerformanceSchema),
  // Derivado de la tupla de dominio (una sola lista). `.catch`: una causa que
  // este cliente aún no conoce (escrita por una versión más nueva) no puede
  // invalidar el registro completo; el evento sobrevive sin causa.
  failureReason: nullableOptional(
    z.catch(z.optional(z.enum(RAYEN_SYNC_FAILURE_REASONS)), undefined)
  ),
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

// Each top-level field of a day with its own schema. The salvage path validates them one by one,
// so one invalid value never costs the day its other fields (signature, CUDYR lock, unknown ones).
export const DailyRecordFieldsSchema = z.looseObject({
  date: StringSchema.check(z.regex(DATE_REGEX)),
  beds: z.prefault(z.record(StringSchema, PatientDataSchema), {}),
  bedTypeOverrides: z.prefault(
    preprocess(
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
    ),
    {}
  ),
  discharges: nullishDefault(z.array(DischargeDataSchema), () => []),
  transfers: nullishDefault(z.array(TransferDataSchema), () => []),
  cma: nullishDefault(z.array(CMADataSchema), () => []),
  lastUpdated: z.prefault(StringSchema, () => new Date().toISOString()),
  rayenSync: nullableOptional(RayenSyncMetaSchema),
  rayenSyncHistory: nullableOptional(z.array(RayenSyncEventSchema)),
  rayenBedCollisionResolutions: nullableOptional(z.array(RayenBedCollisionResolutionReceiptSchema)),
  // Kept as stored, whatever its shape: the clinicalDerived contract decides whether the day
  // is marked, unmarked or unsupported, so a marker this client does not understand is never
  // dropped (and never sends the whole day to the salvage path).
  clinicalDerivedLayout: nullableOptional(z.unknown()),
  dateTimestamp: nullableOptional(z.number()),
  schemaVersion: z.prefault(z.number(), 1),
  nurses: TwoStaffSlotsSchema,
  nurseName: NullableOptionalStringSchema,
  nursesDayShift: TwoStaffSlotsSchema,
  nursesNightShift: TwoStaffSlotsSchema,
  tensDayShift: ThreeStaffSlotsSchema,
  tensNightShift: ThreeStaffSlotsSchema,
  staffingDetailsV1: nullableOptional(DailyRecordStaffingDetailsSchema),
  activeExtraBeds: EmptyStringArraySchema,
  handoffSharedChecklist: nullableOptional(HandoffSharedChecklistSchema),
  handoffDayChecklist: z.prefault(
    z.object({
      escalaBraden: OptionalBooleanSchema,
      escalaRiesgoCaidas: OptionalBooleanSchema,
      escalaRiesgoLPP: OptionalBooleanSchema,
    }),
    {}
  ),
  handoffNightChecklist: z.prefault(
    z.object({
      estadistica: OptionalBooleanSchema,
      categorizacionCudyr: OptionalBooleanSchema,
      encuestaUTI: OptionalBooleanSchema,
      encuestaMedias: OptionalBooleanSchema,
      conteoMedicamento: OptionalBooleanSchema,
      conteoNoControlados: OptionalBooleanSchema,
      conteoNoControladosProximaFecha: NullableOptionalStringSchema,
    }),
    {}
  ),
  handoffNovedadesDayShift: NullableOptionalStringSchema,
  handoffNovedadesNightShift: NullableOptionalStringSchema,
  medicalHandoffNovedades: NullableOptionalStringSchema,
  medicalHandoffBySpecialty: nullableOptional(
    z.record(StringSchema, MedicalSpecialtyHandoffNoteSchema)
  ),
  medicalHandoffDoctor: NullableOptionalStringSchema,
  medicalHandoffSentAt: NullableOptionalStringSchema,
  medicalHandoffSentAtByScope: OptionalMedicalHandoffScopesSchema,
  medicalSignatureLinkTokenByScope: OptionalMedicalHandoffScopesSchema,
  medicalSignature: OptionalMedicalSignatureSchema,
  medicalSignatureByScope: nullableOptional(
    z.object({
      all: OptionalMedicalSignatureSchema,
      upc: OptionalMedicalSignatureSchema,
      'no-upc': OptionalMedicalSignatureSchema,
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
});

export const DailyRecordSchema: z.ZodMiniType<DailyRecord, unknown> = preprocess(input => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }

  return applyDailyRecordStaffingCompatibility(
    input as Pick<DailyRecord, 'nurses' | 'nurseName' | 'nursesDayShift' | 'nursesNightShift'>
  );
}, DailyRecordFieldsSchema);
