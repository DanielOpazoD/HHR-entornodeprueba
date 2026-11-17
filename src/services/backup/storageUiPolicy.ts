import type { StorageListReport } from '@/types/backupArtifacts';
import type { StorageLookupResult } from '@/services/backup/storageLookupContracts';
import {
  createDegradedNotice,
  createInfoNotice,
  createPassiveVerificationPermissionNotice,
  createRetryingNotice,
  type OperationalNotice,
} from '@/shared/feedback/operationalNoticePolicy';

export const getStorageLookupNotice = (
  result: StorageLookupResult,
  artifactLabel: string
): OperationalNotice | null => {
  if (result.status === 'restricted') {
    return createPassiveVerificationPermissionNotice(artifactLabel);
  }

  if (result.status === 'timeout') {
    return null;
  }

  return null;
};

export const getStorageListNotice = (report: StorageListReport): OperationalNotice | null => {
  const degradedCount = report.skippedRestricted + report.skippedUnknown + report.skippedUnparsed;

  if (report.timedOut) {
    return createRetryingNotice(
      'Carga parcial de respaldos',
      'La consulta a Storage tardó demasiado. La lista puede estar incompleta.'
    );
  }

  if (report.skippedRestricted > 0) {
    return createInfoNotice(
      'Carga parcial de respaldos',
      `${report.skippedRestricted} archivo(s) no pudieron leerse por restricciones de acceso.`
    );
  }

  if (degradedCount > 0) {
    return createDegradedNotice(
      'Carga parcial de respaldos',
      `${degradedCount} archivo(s) fueron omitidos por datos o metadata incompatibles.`
    );
  }

  return null;
};
