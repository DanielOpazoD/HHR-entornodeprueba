import {
  buildSpecialistHandoffTargets,
  sameSpecialistHandoffTarget,
} from '@/services/storage/firestore/specialistMedicalHandoffIdentity';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import { resolveClinicalEpisodeIdentifier } from '@/application/patient-flow/clinicalEpisode';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import type { SyncTask, SyncTaskContract } from '@/services/storage/syncQueueTypes';
import { buildSyncMutationIdentity } from '@/services/storage/sync/syncMutationIdentity';

const normalizeText = (value: unknown): string => String(value || '').trim();

const hasActivePatientIdentity = (patient: PatientData | undefined): patient is PatientData =>
  Boolean(
    patient &&
    !patient.isBlocked &&
    (normalizeText(patient.rut) ||
      normalizeText(patient.patientName) ||
      normalizeText(patient.admissionDate))
  );

const collectPatientEpisodeKeys = (patient: PatientData | undefined): string[] => {
  if (!hasActivePatientIdentity(patient)) {
    return [];
  }

  const keys = [resolveClinicalEpisodeIdentifier(patient)];

  if (patient.clinicalCrib) {
    keys.push(...collectPatientEpisodeKeys(patient.clinicalCrib));
  }

  return keys;
};

const resolveOptionalBaseRevision = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const revision = Number(value);
  return Number.isInteger(revision) && revision >= 0 ? revision : undefined;
};

export const resolveRecordBaseRevision = (record: DailyRecord): number | undefined =>
  resolveOptionalBaseRevision((record as { meta?: { revision?: unknown } }).meta?.revision);

export const buildDailyRecordSyncContract = (
  record: DailyRecord,
  baseContract: SyncTaskContract = {}
): SyncTaskContract => {
  const mutationIdentity = buildSyncMutationIdentity();
  const baseContractWithoutRevision = { ...baseContract };
  delete baseContractWithoutRevision.baseRevision;
  const baseRevision =
    resolveOptionalBaseRevision(baseContract.baseRevision) ?? resolveRecordBaseRevision(record);
  const clinicalEpisodeKeys = Array.from(
    new Set([
      ...(baseContract.clinicalEpisodeKeys || []),
      ...Object.values(record.beds || {}).flatMap(collectPatientEpisodeKeys),
    ])
  ).filter(Boolean);

  return {
    ...baseContractWithoutRevision,
    expectedVersion: baseContract.expectedVersion || record.lastUpdated,
    ...(baseRevision !== undefined ? { baseRevision } : {}),
    recordRevision: record.lastUpdated,
    clinicalEpisodeKeys,
    changedPaths: baseContract.changedPaths?.length ? baseContract.changedPaths : undefined,
    mutationId: baseContract.mutationId || mutationIdentity.mutationId,
    clientId: baseContract.clientId || mutationIdentity.clientId,
    tabId: baseContract.tabId || mutationIdentity.tabId,
  };
};

export const buildSyncTaskContract = (
  type: SyncTask['type'],
  payload: unknown,
  baseContract?: SyncTaskContract
): SyncTaskContract | undefined => {
  if (type !== 'UPDATE_DAILY_RECORD') {
    return baseContract;
  }

  return buildDailyRecordSyncContract(payload as DailyRecord, baseContract);
};

const mergeUnique = (
  left: string[] | undefined,
  right: string[] | undefined
): string[] | undefined => {
  const values = [...(left || []), ...(right || [])].filter(Boolean);
  if (values.includes('*')) {
    return ['*'];
  }
  const merged = Array.from(new Set(values));
  return merged.length > 0 ? merged : undefined;
};

const mergeMutationIds = (
  existing: SyncTaskContract | undefined,
  next: SyncTaskContract | undefined
): string[] | undefined => {
  const values = [
    ...(existing?.mutationIds || []),
    existing?.mutationId,
    ...(next?.mutationIds || []),
    next?.mutationId,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const merged = Array.from(new Set(values));
  return merged.length > 1 ? merged : undefined;
};

export const mergeSyncTaskContracts = (
  existing: SyncTaskContract | undefined,
  next: SyncTaskContract | undefined
): SyncTaskContract | undefined => {
  if (!existing) return next;
  if (!next) return existing;

  const targets = [
    ...(existing.specialistHandoffTargets || []),
    ...(next.specialistHandoffTargets || []),
  ];
  const byTarget = new Map<string, (typeof targets)[number]>();
  for (const target of targets) {
    const key = `${target.bedId}.${target.target}`;
    const previous = byTarget.get(key);
    if (previous && !sameSpecialistHandoffTarget(previous, target)) {
      throw new ConcurrencyError(
        'Existe una entrega pendiente de otro paciente o episodio; debe revisarse antes de reemplazarla.',
        'semantic_conflict'
      );
    }
    byTarget.set(key, target);
  }
  return {
    ...existing,
    ...next,
    ...(byTarget.size ? { specialistHandoffTargets: [...byTarget.values()] } : {}),
    expectedVersion: next.expectedVersion ?? existing.expectedVersion,
    baseRevision: next.baseRevision ?? existing.baseRevision,
    changedPaths: mergeUnique(existing.changedPaths, next.changedPaths),
    clinicalEpisodeKeys: mergeUnique(existing.clinicalEpisodeKeys, next.clinicalEpisodeKeys),
    mutationIds: mergeMutationIds(existing, next),
  };
};

/** Refuse a coalesced payload that would erase an unresolved note from its original occupant. */
export const assertPendingHandoffContinuity = (
  existing: SyncTask | null,
  next: DailyRecord
): void => {
  if (!existing || existing.type !== 'UPDATE_DAILY_RECORD') return;
  const paths = (existing.syncContract?.changedPaths || []).filter(path =>
    /^beds\.[^.]+\.(?:clinicalCrib\.)?medicalHandoff(?:Note|Entries|Audit)$/.test(path)
  );
  if (!paths.length) return;
  const patch = Object.fromEntries(paths.map(path => [path, undefined]));
  const expected =
    existing.syncContract?.specialistHandoffTargets ||
    buildSpecialistHandoffTargets(existing.payload as DailyRecord, patch);
  const actual = buildSpecialistHandoffTargets(next, patch);
  if (
    expected.some(target => !actual.some(current => sameSpecialistHandoffTarget(current, target)))
  ) {
    throw new ConcurrencyError(
      'La cola conserva una entrega del paciente anterior. Revisa ese conflicto antes de reemplazar su contenido.',
      'semantic_conflict'
    );
  }
};

/** Keep the original payload recoverable without owning the day's next write. */
export const preserveIncompatibleHandoffTask = async (
  store: Pick<import('./syncQueuePorts').SyncQueueStorePort, 'update'>,
  existing: SyncTask | null,
  record: DailyRecord,
  onConflict: (task: SyncTask) => void
): Promise<SyncTask | null> => {
  try {
    assertPendingHandoffContinuity(existing, record);
    return existing;
  } catch (error) {
    if (!(error instanceof ConcurrencyError) || !existing?.id) throw error;
    onConflict(existing);
    await store.update(existing.id, {
      key: `${existing.key}:handoff-conflict:${existing.id}`,
      status: 'CONFLICT',
      error: 'Entrega pendiente de otro paciente o episodio. Se conserva para revisión.',
      lastErrorCategory: 'conflict',
      lastErrorAction: 'Revisar la entrega original antes de reintentar o descartar.',
    });
    return null;
  }
};

export const publishPreservedHandoffDraft = async (task?: SyncTask): Promise<void> => {
  if (!task) return;
  const { preserveQueuedMedicalHandoffDrafts } = await import('../medicalHandoffDraftStorage');
  preserveQueuedMedicalHandoffDrafts(task);
};
