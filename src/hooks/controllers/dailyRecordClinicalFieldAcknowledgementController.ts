import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type { HydratedRemoteClinicalFieldLocksByBedId } from '@/hooks/controllers/dailyRecordHydratedRemotePatchRiskController';

export type DailyRecordClinicalFieldGroup =
  | 'diagnosis'
  | 'status'
  | 'specialty'
  | 'upc'
  | 'surgicalComplication';

export interface ClinicalFieldPauseState {
  createdAt: number;
  acknowledged: boolean;
}

export type DailyRecordClinicalPatchPauseDecision =
  | { kind: 'allowed' }
  | {
      kind: 'soft_pause';
      bedId: string;
      fieldGroup: DailyRecordClinicalFieldGroup;
      message: string;
    }
  | { kind: 'hard_lock'; bedId: string; message: string };

const FIELD_PAUSE_TTL_MS = 3 * 60 * 1_000;
export const DAILY_RECORD_FIELD_PAUSE_MESSAGE =
  'Actualizado recién. Intente nuevamente para editar.';
export const DAILY_RECORD_CONTEXT_RESET_MESSAGE =
  'Esta cama se actualizó hace un momento. Seleccione nuevamente el paciente para continuar.';

const pausesByDate = new Map<
  string,
  Record<string, Partial<Record<DailyRecordClinicalFieldGroup, ClinicalFieldPauseState>>>
>();
const hardLockedBedsByDate = new Map<string, Set<string>>();

const resolveGroupFromField = (field: string): DailyRecordClinicalFieldGroup | null => {
  if (['pathology', 'cie10Code', 'cie10Description', 'diagnosisComments'].includes(field)) {
    return 'diagnosis';
  }
  if (field === 'status') return 'status';
  if (field === 'specialty' || field === 'secondarySpecialty') return 'specialty';
  if (field === 'isUPC' || field === 'upcChecklist') return 'upc';
  if (field === 'surgicalComplication') return 'surgicalComplication';
  if (
    [
      'ginecobstetriciaType',
      'deliveryDate',
      'deliveryRoute',
      'deliveryCesareanLabor',
      'clinicalCrib',
    ].includes(field)
  ) {
    return 'diagnosis';
  }
  return null;
};

const parseBedPatchPath = (
  path: string
): { bedId: string; fieldGroup: DailyRecordClinicalFieldGroup | null } | null => {
  const clinicalCribMatch = path.match(/^beds\.([^.]+)\.clinicalCrib\.([^.]+)/);
  if (clinicalCribMatch) {
    return {
      bedId: clinicalCribMatch[1],
      fieldGroup: resolveGroupFromField(clinicalCribMatch[2]),
    };
  }

  const match = path.match(/^beds\.([^.]+)(?:\.([^.]+))?/);
  if (!match) return null;
  return {
    bedId: match[1],
    fieldGroup: match[2] ? resolveGroupFromField(match[2]) : null,
  };
};

interface ResolveClinicalPatchDecisionOptions {
  previousRecord?: DailyRecord | null;
}

const hasMeaningfulIdentityValue = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().length > 0;

const hasOwnPatchPath = (patch: DailyRecordPatch, path: string): boolean =>
  Object.prototype.hasOwnProperty.call(patch, path);

const getPatchPathValue = (patch: DailyRecordPatch, path: string): unknown =>
  (patch as Record<string, unknown>)[path];

const isEmptyBedIdentityActivationPatch = (
  patch: DailyRecordPatch,
  bedId: string,
  previousRecord: DailyRecord | null | undefined
): boolean => {
  const previousBed = previousRecord?.beds?.[bedId];
  if (!previousBed) return false;

  const hadIdentity =
    hasMeaningfulIdentityValue(previousBed.patientName) ||
    hasMeaningfulIdentityValue(previousBed.rut);
  if (hadIdentity) return false;

  const patientNamePath = `beds.${bedId}.patientName`;
  const rutPath = `beds.${bedId}.rut`;
  const touchesIdentity =
    hasOwnPatchPath(patch, patientNamePath) || hasOwnPatchPath(patch, rutPath);
  if (!touchesIdentity) return false;

  const nextPatientName = hasOwnPatchPath(patch, patientNamePath)
    ? getPatchPathValue(patch, patientNamePath)
    : previousBed.patientName;
  const nextRut = hasOwnPatchPath(patch, rutPath)
    ? getPatchPathValue(patch, rutPath)
    : previousBed.rut;

  return hasMeaningfulIdentityValue(nextPatientName) || hasMeaningfulIdentityValue(nextRut);
};

const isClinicalCribActivationPatch = (
  patch: DailyRecordPatch,
  bedId: string,
  previousRecord: DailyRecord | null | undefined
): boolean => {
  const previousCrib = previousRecord?.beds?.[bedId]?.clinicalCrib;
  const previousHadCribIdentity =
    hasMeaningfulIdentityValue(previousCrib?.patientName) ||
    hasMeaningfulIdentityValue(previousCrib?.rut);

  return (
    !previousHadCribIdentity &&
    Object.keys(patch).some(path => path.startsWith(`beds.${bedId}.clinicalCrib.`))
  );
};

const isPauseExpired = (state: ClinicalFieldPauseState, now: number): boolean =>
  now - state.createdAt >= FIELD_PAUSE_TTL_MS;

export const registerDailyRecordClinicalFieldPauses = (
  date: string,
  locksByBedId: HydratedRemoteClinicalFieldLocksByBedId,
  createdAt: number
): void => {
  void locksByBedId;
  void createdAt;
  pausesByDate.delete(date);
  hardLockedBedsByDate.delete(date);
};

export const getDailyRecordClinicalFieldPause = (
  date: string,
  bedId: string,
  fieldGroup: DailyRecordClinicalFieldGroup,
  now: number = Date.now()
): ClinicalFieldPauseState | null => {
  const state = pausesByDate.get(date)?.[bedId]?.[fieldGroup];
  if (!state || isPauseExpired(state, now)) {
    return null;
  }
  return state;
};

export const acknowledgeDailyRecordClinicalFieldPause = (
  date: string,
  bedId: string,
  fieldGroup: DailyRecordClinicalFieldGroup
): 'acknowledged' | 'already_acknowledged' | 'hard_locked' | 'none' => {
  const state = pausesByDate.get(date)?.[bedId]?.[fieldGroup];
  if (!state) return 'none';
  if (state.acknowledged) return 'already_acknowledged';
  state.acknowledged = true;
  return 'acknowledged';
};

export const resolveDailyRecordClinicalPatchPauseDecision = (
  date: string,
  patch: DailyRecordPatch,
  now: number = Date.now(),
  options: ResolveClinicalPatchDecisionOptions = {}
): DailyRecordClinicalPatchPauseDecision => {
  for (const path of Object.keys(patch)) {
    const parsed = parseBedPatchPath(path);
    if (!parsed?.fieldGroup) continue;
    const pause = getDailyRecordClinicalFieldPause(date, parsed.bedId, parsed.fieldGroup, now);
    if (!pause || pause.acknowledged) continue;
    if (isEmptyBedIdentityActivationPatch(patch, parsed.bedId, options.previousRecord)) continue;
    if (isClinicalCribActivationPatch(patch, parsed.bedId, options.previousRecord)) continue;
    return {
      kind: 'soft_pause',
      bedId: parsed.bedId,
      fieldGroup: parsed.fieldGroup,
      message: DAILY_RECORD_FIELD_PAUSE_MESSAGE,
    };
  }
  return { kind: 'allowed' };
};

export const resolveDailyRecordClinicalPatchLockDecision = (
  date: string,
  patch: DailyRecordPatch,
  locksByBedId: HydratedRemoteClinicalFieldLocksByBedId,
  now: number = Date.now(),
  options: ResolveClinicalPatchDecisionOptions = {}
): DailyRecordClinicalPatchPauseDecision => {
  void locksByBedId;
  return resolveDailyRecordClinicalPatchPauseDecision(date, patch, now, options);
};

export const clearDailyRecordClinicalFieldPausesForTests = (): void => {
  pausesByDate.clear();
  hardLockedBedsByDate.clear();
};
