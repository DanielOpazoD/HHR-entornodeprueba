import { ConcurrencyError } from '@/services/storage/firestore/firestoreRecordWrites';
import { DataRegressionError, VersionMismatchError } from '@/utils/integrityGuard';
import { resolveApplicationOutcomeMessage } from '@/shared/contracts/applicationOutcomeMessage';
import { AdmissionDatePolicyViolationError } from '@/application/patient-flow/admissionDatePolicy';
import type {
  SaveDailyRecordResult,
  UpdatePartialDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';
import { isDailyRecordWriteBlockedResult } from '@/services/repositories/contracts/dailyRecordResults';
import {
  createBlockedNotice,
  createDegradedNotice,
  createRetryingNotice,
  type OperationalNotice,
} from '@/shared/feedback/operationalNoticePolicy';

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

  if (error instanceof AdmissionDatePolicyViolationError) {
    return {
      title: 'Fecha de Ingreso Bloqueada',
      message: error.message,
      shouldLog: true,
      logLabel: '[Sync] Admission date policy blocked save:',
    };
  }

  return null;
};

interface SyncOutcomeFeedback {
  channel: 'warning' | 'error';
  title: string;
  message: string;
  state: OperationalNotice['state'];
  actionRequired: boolean;
}

const createSyncRetrying = (title: string, message: string): SyncOutcomeFeedback => ({
  ...createRetryingNotice(title, message),
  channel: 'warning',
});

const createSyncDegraded = (title: string, message: string): SyncOutcomeFeedback => ({
  ...createDegradedNotice(title, message),
  channel: 'warning',
});

const createSyncBlocked = (title: string, message: string): SyncOutcomeFeedback => ({
  ...createBlockedNotice(title, message),
  channel: 'error',
});

const resolveSyncConsistencyMessage = (
  result: { userSafeMessage?: string },
  fallbackMessage: string
): string => resolveApplicationOutcomeMessage(result, fallbackMessage);

export const resolveSaveOutcomeFeedback = (
  result: SaveDailyRecordResult | null | undefined
): SyncOutcomeFeedback | null => {
  if (!result) {
    return null;
  }

  if (result.outcome === 'queued') {
    return createSyncRetrying(
      'Guardado local pendiente',
      'Los cambios se guardaron localmente y quedarán pendientes de sincronización.'
    );
  }

  if (result.outcome === 'auto_merged') {
    return createSyncDegraded(
      'Censo actualizado',
      'El sistema integró los cambios recientes automáticamente.'
    );
  }

  if (result.consistencyState === 'unrecoverable') {
    return createSyncDegraded(
      'Guardado local sin sincronización',
      resolveSyncConsistencyMessage(
        result,
        'Los cambios quedaron guardados localmente, pero requieren revisión antes de quedar confirmados.'
      )
    );
  }

  if (isDailyRecordWriteBlockedResult(result)) {
    return createSyncBlocked(
      result.consistencyState === 'blocked_regression'
        ? 'Protección de Datos'
        : result.consistencyState === 'blocked_version_mismatch'
          ? 'Versión de Datos Antigua'
          : 'Fecha de Ingreso Bloqueada',
      resolveSyncConsistencyMessage(
        result,
        'La operación quedó bloqueada por una validación de datos recientes.'
      )
    );
  }

  return null;
};

export const resolvePatchOutcomeFeedback = (
  result: UpdatePartialDailyRecordResult | null | undefined
): SyncOutcomeFeedback | null => {
  if (!result) {
    return null;
  }

  if (isDailyRecordWriteBlockedResult(result)) {
    return createSyncBlocked(
      result.consistencyState === 'blocked_regression'
        ? 'Protección de Datos'
        : result.consistencyState === 'blocked_version_mismatch'
          ? 'Versión de Datos Antigua'
          : 'Actualización bloqueada',
      resolveSyncConsistencyMessage(
        result,
        'La actualización quedó bloqueada por una validación de datos recientes.'
      )
    );
  }

  if (result.outcome === 'queued') {
    return createSyncRetrying(
      'Cambio pendiente de sincronización',
      'La actualización quedó guardada localmente y se reintentará la sincronización.'
    );
  }

  if (result.outcome === 'auto_merged') {
    return createSyncDegraded(
      'Cambio actualizado',
      'El sistema integró los cambios recientes automáticamente.'
    );
  }

  if (result.outcome === 'blocked') {
    return createSyncBlocked(
      'Actualización bloqueada',
      resolveSyncConsistencyMessage(
        result,
        'No se encontró un registro local válido para aplicar el cambio.'
      )
    );
  }

  if (result.consistencyState === 'unrecoverable') {
    return createSyncDegraded(
      'Cambio local sin sincronización',
      resolveSyncConsistencyMessage(
        result,
        'El cambio quedó guardado localmente, pero requiere revisión antes de quedar confirmado.'
      )
    );
  }

  return null;
};
