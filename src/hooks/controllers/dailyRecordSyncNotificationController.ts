import { ConcurrencyError } from '@/services/storage/firestoreService';
import { DataRegressionError, VersionMismatchError } from '@/utils/integrityGuard';

interface SaveErrorFeedback {
  title: string;
  message: string;
  refetchDelayMs?: number;
  shouldLog?: boolean;
  logLabel?: string;
}

export const resolveSaveErrorFeedback = (error: unknown): SaveErrorFeedback | null => {
  if (error instanceof ConcurrencyError) {
    return {
      title: 'Conflicto de Edición',
      message: error.message,
      refetchDelayMs: 2000,
    };
  }

  if (error instanceof DataRegressionError) {
    return {
      title: 'Protección de Datos',
      message: error.message,
      refetchDelayMs: 3000,
      shouldLog: true,
      logLabel: '[Sync] Data regression blocked:',
    };
  }

  if (error instanceof VersionMismatchError) {
    return {
      title: 'Versión de Datos Antigua',
      message: error.message,
      refetchDelayMs: 5000,
      shouldLog: true,
      logLabel: '[Sync] Version mismatch blocked save:',
    };
  }

  return null;
};
