import { isValidCrashCartReviewDate } from '@/domain/handoff/sharedChecklist';
import {
  buildChecklistPatch,
  buildChecklistUpdateRecord,
  buildHandoffStaffPatch,
  buildNovedadesPatch,
  buildNovedadesUpdateRecord,
  buildUpdatedHandoffStaffRecord,
} from '@/domain/handoff/management';
import type {
  ApplyDailyRecordPatch,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import { createApplicationSuccess } from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

import type { HandoffDailyRecordContract } from '@/domain/handoff/recordContracts';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { createMissingRecordOutcome, createValidationOutcome } from './handoffUseCaseSupport';

export interface PersistedHandoffRecordOutput {
  updatedRecord: HandoffDailyRecordContract;
}

interface PersistRecordInput {
  record: HandoffDailyRecordContract | null;
  saveRecord: PersistDailyRecord;
  patchRecord?: ApplyDailyRecordPatch;
}

interface UpdateHandoffChecklistInput extends PersistRecordInput {
  field: string;
  shift: 'day' | 'night' | 'shared';
  value: boolean | string;
}

interface UpdateHandoffNovedadesInput extends PersistRecordInput {
  shift: 'day' | 'night';
  value: string;
}

interface UpdateHandoffStaffInput extends PersistRecordInput {
  shift: 'day' | 'night';
  staffList: string[];
  type: 'delivers' | 'receives' | 'tens';
}

/**
 * Persist via patch if available, otherwise fall back to full save.
 * The patch path uses Firestore updateDoc (field-level), which is safe
 * for concurrent edits by different users on different fields.
 */
const persistWithPatchPreference = async (
  input: PersistRecordInput,
  patch: DailyRecordPatch | null,
  updatedRecord: HandoffDailyRecordContract
): Promise<void> => {
  if (input.patchRecord && patch) {
    await input.patchRecord(patch);
  } else {
    await input.saveRecord(updatedRecord, input.record ?? undefined);
  }
};

export const executeUpdateHandoffChecklist = async (
  input: UpdateHandoffChecklistInput
): Promise<ApplicationOutcome<PersistedHandoffRecordOutput | null>> => {
  if (!input.record) {
    return createMissingRecordOutcome(null, 'update_handoff_checklist', 'No hay entrega activa.');
  }

  if (
    input.shift === 'shared' &&
    (typeof input.value !== 'string' ||
      !(
        (input.field === 'crashCartCode' && /^(?:[0-9]{8})?$/.test(input.value)) ||
        (input.field === 'crashCartReviewDate' && isValidCrashCartReviewDate(input.value))
      ))
  ) {
    return createValidationOutcome(
      null,
      'update_handoff_checklist',
      'invalid_shared_checklist',
      'Revise la fecha del carro de paro y use un código de 8 dígitos.'
    );
  }

  const updatedRecord = buildChecklistUpdateRecord(
    input.record,
    input.shift,
    input.field,
    input.value
  );
  const patch = buildChecklistPatch(input.shift, input.field, input.value);
  await persistWithPatchPreference(input, patch, updatedRecord);
  return createApplicationSuccess({ updatedRecord });
};

export const executeUpdateHandoffNovedades = async (
  input: UpdateHandoffNovedadesInput
): Promise<ApplicationOutcome<PersistedHandoffRecordOutput | null>> => {
  if (!input.record) {
    return createMissingRecordOutcome(null, 'update_handoff_novedades', 'No hay entrega activa.');
  }

  const updatedRecord = buildNovedadesUpdateRecord(input.record, input.shift, input.value);
  const patch = buildNovedadesPatch(input.shift, input.value);
  await persistWithPatchPreference(input, patch, updatedRecord);
  return createApplicationSuccess({ updatedRecord });
};

export const executeUpdateHandoffStaff = async (
  input: UpdateHandoffStaffInput
): Promise<ApplicationOutcome<PersistedHandoffRecordOutput | null>> => {
  if (!input.record) {
    return createMissingRecordOutcome(null, 'update_handoff_staff', 'No hay entrega activa.');
  }

  const updatedRecord = buildUpdatedHandoffStaffRecord(
    input.record,
    input.shift,
    input.type,
    input.staffList
  );
  const patch = buildHandoffStaffPatch(input.shift, input.type, input.staffList);
  await persistWithPatchPreference(input, patch, updatedRecord);
  return createApplicationSuccess({ updatedRecord });
};
