import { z } from 'zod';
import { DailyRecord } from '@/types/domain/dailyRecord';
import { DATE_REGEX, nullableOptional, nullishDefault } from './helpers';
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
  uid: z.string(),
  displayName: z.string(),
  email: z.string(),
  specialty: nullableOptional(z.string()),
  role: nullableOptional(z.string()),
});
const MedicalHandoffDailyContinuityEntrySchema = z.object({
  status: z.enum(['updated_by_specialist', 'confirmed_no_changes']),
  confirmedBy: nullableOptional(MedicalHandoffActorSchema),
  confirmedAt: nullableOptional(z.string()),
  comment: nullableOptional(z.string()),
});

const MedicalSpecialtyHandoffNoteSchema = z.object({
  note: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
  author: MedicalHandoffActorSchema,
  lastEditor: nullableOptional(MedicalHandoffActorSchema),
  version: z.number().default(1),
  dailyContinuity: nullableOptional(z.record(z.string(), MedicalHandoffDailyContinuityEntrySchema)),
});

const DetailedStaffAssignmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['nurse', 'tens']),
  slotType: z.enum(['standard', 'extra']),
  standardSlotIndex: nullableOptional(z.number()),
  startTime: z.string(),
  endTime: z.string(),
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
        bedId: z.string(),
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
  completedAt: z.string(),
});

const RayenSyncChangesSchema = z.object({
  admissions: z.number().int().nonnegative(),
  updates: z.number().int().nonnegative(),
  moves: z.number().int().nonnegative(),
  discharges: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
});

const RayenSyncSourceSchema = z.object({
  extensionVersion: nullableOptional(z.string()),
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
          name: z.string(),
          role: z.string(),
          recordedAt: z.string(),
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
  historicalCorrectionsPending: z.boolean(),
  historicalCorrectionsRequireFreshCapture: z.boolean(),
  isolatedConflicts: z.number().int().nonnegative(),
  deferredHistoricalAdmissionBedIds: nullableOptional(
    z.array(z.string().min(1).max(32)).max(MAX_RAYEN_STRUCTURAL_REVIEW_ISSUES)
  ),
  issues: nullableOptional(
    z
      .array(
        z.object({
          bedId: z.string().nullable(),
          reason: z
            .enum([
              'unconfirmed-principal-bed',
              'principal-bed-collision',
              'cma-physical-bed-collision',
              'occupied-local-bed',
              'historical-reconstruction',
              'historical-admission-evidence',
              'unverified-report-row',
              'unclassified',
            ])
            .catch('unclassified'),
        })
      )
      .max(MAX_RAYEN_STRUCTURAL_REVIEW_ISSUES)
  ),
});

export const RayenSyncEventSchema = z.object({
  id: z.string(),
  sourceDate: nullableOptional(z.string().regex(DATE_REGEX)),
  startedAt: z.string(),
  completedAt: nullableOptional(z.string()),
  by: z.string(),
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
  staffingObservation: nullableOptional(RayenSyncStaffingObservationSchema),
  structuralReview: nullableOptional(RayenSyncStructuralReviewSchema),
  performance: nullableOptional(RayenSyncPerformanceSchema),
  // Derivado de la tupla de dominio (una sola lista). `.catch`: una causa que
  // este cliente aún no conoce (escrita por una versión más nueva) no puede
  // invalidar el registro completo; el evento sobrevive sin causa.
  failureReason: nullableOptional(z.enum(RAYEN_SYNC_FAILURE_REASONS).optional().catch(undefined)),
});

export const RayenSyncMetaSchema = z.object({
  at: z.string(),
  by: z.string(),
  runId: nullableOptional(z.string()),
  status: nullableOptional(z.enum(['applied', 'complete', 'partial'])),
  coverage: nullableOptional(RayenSyncCoverageSchema),
  changes: nullableOptional(RayenSyncChangesSchema),
  source: nullableOptional(RayenSyncSourceSchema),
  staffingObservation: nullableOptional(RayenSyncStaffingObservationSchema),
});

export const RayenBedCollisionResolutionReceiptSchema = z.object({
  id: z.string(),
  selectedEpisodeId: z.string(),
  otherEpisodeId: z.string(),
  otherDisposition: z.union([
    z.object({ kind: z.literal('move'), targetBedId: z.string() }),
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
      date: z.string().regex(DATE_REGEX),
      beds: z.record(z.string(), PatientDataSchema).default({}),
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
          z.record(z.string(), BedTypeSchema)
        )
        .default({}),
      discharges: nullishDefault(z.array(DischargeDataSchema), () => []),
      transfers: nullishDefault(z.array(TransferDataSchema), () => []),
      cma: nullishDefault(z.array(CMADataSchema), () => []),
      lastUpdated: z.string().default(() => new Date().toISOString()),
      rayenSync: nullableOptional(RayenSyncMetaSchema),
      rayenSyncHistory: nullableOptional(z.array(RayenSyncEventSchema)),
      rayenBedCollisionResolutions: nullableOptional(
        z.array(RayenBedCollisionResolutionReceiptSchema)
      ),
      dateTimestamp: nullableOptional(z.number()),
      schemaVersion: z.number().default(1),
      nurses: nullishDefault(z.array(z.string()), () => ['', '']),
      nurseName: nullableOptional(z.string()),
      nursesDayShift: nullishDefault(z.array(z.string()), () => ['', '']),
      nursesNightShift: nullishDefault(z.array(z.string()), () => ['', '']),
      tensDayShift: nullishDefault(z.array(z.string()), () => ['', '', '']),
      tensNightShift: nullishDefault(z.array(z.string()), () => ['', '', '']),
      staffingDetailsV1: nullableOptional(DailyRecordStaffingDetailsSchema),
      activeExtraBeds: nullishDefault(z.array(z.string()), () => []),
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
          conteoNoControladosProximaFecha: nullableOptional(z.string()),
        })
        .default({}),
      handoffNovedadesDayShift: nullableOptional(z.string()),
      handoffNovedadesNightShift: nullableOptional(z.string()),
      medicalHandoffNovedades: nullableOptional(z.string()),
      medicalHandoffBySpecialty: nullableOptional(
        z.record(z.string(), MedicalSpecialtyHandoffNoteSchema)
      ),
      medicalHandoffDoctor: nullableOptional(z.string()),
      medicalHandoffSentAt: nullableOptional(z.string()),
      medicalHandoffSentAtByScope: nullableOptional(
        z.object({
          all: nullableOptional(z.string()),
          upc: nullableOptional(z.string()),
          'no-upc': nullableOptional(z.string()),
        })
      ),
      medicalSignatureLinkTokenByScope: nullableOptional(
        z.object({
          all: nullableOptional(z.string()),
          upc: nullableOptional(z.string()),
          'no-upc': nullableOptional(z.string()),
        })
      ),
      medicalSignature: nullableOptional(
        z.object({
          doctorName: z.string(),
          signedAt: z.string(),
          userAgent: nullableOptional(z.string()),
        })
      ),
      medicalSignatureByScope: nullableOptional(
        z.object({
          all: nullableOptional(
            z.object({
              doctorName: z.string(),
              signedAt: z.string(),
              userAgent: nullableOptional(z.string()),
            })
          ),
          upc: nullableOptional(
            z.object({
              doctorName: z.string(),
              signedAt: z.string(),
              userAgent: nullableOptional(z.string()),
            })
          ),
          'no-upc': nullableOptional(
            z.object({
              doctorName: z.string(),
              signedAt: z.string(),
              userAgent: nullableOptional(z.string()),
            })
          ),
        })
      ),
      cudyrLocked: nullableOptional(z.boolean()),
      cudyrLockedAt: nullableOptional(z.string()),
      cudyrLockedBy: nullableOptional(z.string()),
      cudyrUpdatedAt: nullableOptional(z.string()),
      cudyrUpdatedBy: nullableOptional(z.string()),
      cudyrUpdatedById: nullableOptional(z.string()),
      cudyrShiftDate: nullableOptional(z.string()),
      cudyrCompletedAt: nullableOptional(z.string()),
      cudyrCompletedBy: nullableOptional(z.string()),
      handoffNightReceives: nullishDefault(z.array(z.string()), () => []),
    })
    .passthrough()
);

/**
 * Full backup schema for import/export
 */
export const FullBackupSchema = z.record(z.string(), DailyRecordSchema);
