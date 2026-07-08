/**
 * Concrete AdmitPatientPort backed by the daily-record write service.
 *
 * Connects the canonical command (src/application/daily-record/commands/
 * admitPatientCommand) to the existing write pipeline (IndexedDB + Firestore
 * + outbox) without leaking repository or Firestore types out of the service
 * boundary. Consumers obtain a typed AdmittedPatientSnapshot back, regardless
 * of how persistence settled (immediate, queued, retried).
 */
import type {
  AdmitPatientInput,
  AdmitPatientPort,
  AdmittedPatientSnapshot,
} from '@/application/daily-record/commands/admitPatientCommand';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import type { DailyRecordPatch } from '@/services/contracts/dailyRecordServiceContracts';
import { resolveClinicalEpisodeIdForAdmission } from '@/application/patient-flow/clinicalEpisodeIdPolicy';
import type { UpdatePartialDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import { isDailyRecordWriteBlockedResult } from '@/services/repositories/contracts/dailyRecordResults';
import { resolveApplicationOutcomeMessage } from '@/shared/contracts/applicationOutcomeMessage';
import type { PartialUpdateDailyRecordOptions } from '@/services/repositories/contracts/dailyRecordCommands';

export type AdmitPatientPersistenceFn = (
  date: string,
  patch: DailyRecordPatch,
  options?: PartialUpdateDailyRecordOptions
) => Promise<void | UpdatePartialDailyRecordResult>;

export const buildAdmitPatientPatch = (input: AdmitPatientInput): DailyRecordPatch => {
  // Patch keys use computed string template paths; the strict
  // DailyRecordPatch index signature carries a different value type per path
  // and TS cannot prove the narrowing through the dynamic bedId, so we
  // construct via Record<string, unknown> and cast at the boundary.
  const patch: Record<string, unknown> = {
    [`beds.${input.bedId}.patientName`]: input.patientName,
    [`beds.${input.bedId}.rut`]: input.rut,
    [`beds.${input.bedId}.admissionDate`]: input.admissionDate,
    [`beds.${input.bedId}.clinicalEpisodeId`]: resolveClinicalEpisodeIdForAdmission(input),
  };
  if (input.pathology !== undefined) {
    patch[`beds.${input.bedId}.pathology`] = input.pathology;
  }
  return patch as DailyRecordPatch;
};

const buildSnapshotFromInput = (input: AdmitPatientInput): AdmittedPatientSnapshot => ({
  bedId: input.bedId,
  patientName: input.patientName,
  rut: input.rut,
  admissionDate: input.admissionDate,
  clinicalEpisodeId: resolveClinicalEpisodeIdForAdmission(input),
  recordDate: input.recordDate,
});

const assertAdmissionPersistenceAccepted = (
  result: void | UpdatePartialDailyRecordResult
): void => {
  if (!result) {
    return;
  }

  if (
    result.outcome === 'blocked' ||
    result.outcome === 'unrecoverable' ||
    isDailyRecordWriteBlockedResult(result)
  ) {
    throw (
      result.blockingError ||
      new Error(
        resolveApplicationOutcomeMessage(
          result,
          'La admisión quedó bloqueada por una validación de consistencia.'
        )
      )
    );
  }
};

export const createDailyRecordAdmitPatientPort = (
  persist: AdmitPatientPersistenceFn = updatePartialDetailed
): AdmitPatientPort => ({
  persistAdmission: async (input: AdmitPatientInput): Promise<AdmittedPatientSnapshot> => {
    const inputWithEpisodeId: AdmitPatientInput = {
      ...input,
      clinicalEpisodeId: resolveClinicalEpisodeIdForAdmission(input),
    };
    const patch = buildAdmitPatientPatch(inputWithEpisodeId);
    const result = inputWithEpisodeId.baseRecord
      ? await persist(inputWithEpisodeId.recordDate, patch, {
          baseRecord: inputWithEpisodeId.baseRecord,
        })
      : await persist(inputWithEpisodeId.recordDate, patch);
    assertAdmissionPersistenceAccepted(result);
    return buildSnapshotFromInput(inputWithEpisodeId);
  },
});

export const defaultDailyRecordAdmitPatientPort: AdmitPatientPort =
  createDailyRecordAdmitPatientPort();
