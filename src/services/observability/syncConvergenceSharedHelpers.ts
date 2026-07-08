import type { DailyRecord } from '@/services/contracts/dailyRecordServiceContracts';
import type { SyncQueueOperationSnapshot } from '@/services/storage/sync';

type Patient = DailyRecord['beds'][string];

export const normalizeText = (value: unknown): string => String(value || '').trim();

export const normalizeIdentity = (value: unknown): string => normalizeText(value).toLowerCase();

const changedPathCoversPath = (changedPath: unknown, path: string): boolean => {
  const normalizedChangedPath = normalizeText(changedPath);
  const normalizedPath = normalizeText(path);
  if (!normalizedChangedPath || !normalizedPath) return false;
  if (normalizedChangedPath === '*') return true;
  return (
    normalizedChangedPath === normalizedPath ||
    normalizedChangedPath.startsWith(`${normalizedPath}.`) ||
    normalizedPath.startsWith(`${normalizedChangedPath}.`)
  );
};

export const hasPendingOutboxForPath = (
  outbox: SyncQueueOperationSnapshot[],
  path: string
): boolean =>
  outbox.some(operation =>
    (operation.syncContract?.changedPaths || []).some(changedPath =>
      changedPathCoversPath(changedPath, path)
    )
  );

export const describePatient = (
  patient: Patient | undefined,
  fallback = 'Paciente sin identificar'
): string => normalizeText(patient?.patientName) || fallback;
