import { ConcurrencyError } from '@/services/storage/firestore/firestoreRecordWrites';
import { DataRegressionError, VersionMismatchError } from '@/utils/integrityGuard';
import { resolveApplicationOutcomeMessage } from '@/shared/contracts/applicationOutcomeMessage';
import { AdmissionDatePolicyViolationError } from '@/application/patient-flow/admissionDatePolicy';
import type {
  SaveDailyRecordResult,
  UpdatePartialDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';
import {
  isDailyRecordWriteBlockedResult,
  resolveDailyRecordSavedState,
} from '@/services/repositories/contracts/dailyRecordResults';
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

const resolveKnownWriteErrorFeedback = (error: unknown): SaveErrorFeedback | null => {
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

export const resolveSaveErrorFeedback = (error: unknown): SaveErrorFeedback =>
  resolveKnownWriteErrorFeedback(error) ?? {
    title: 'Guardado no confirmado',
    message:
      'No fue posible completar el guardado. La operación no quedó confirmada; revisa el censo antes de reintentar.',
    shouldLog: true,
    logLabel: '[Sync] Save failed:',
  };

export const resolvePatchErrorFeedback = (error: unknown): SaveErrorFeedback =>
  resolveKnownWriteErrorFeedback(error) ?? {
    title: 'Cambio no guardado',
    message:
      'No fue posible completar la actualización. El cambio no quedó confirmado; revisa el censo antes de reintentar.',
    shouldLog: true,
    logLabel: '[Sync] Patch failed:',
  };

interface SyncOutcomeFeedback {
  channel: 'success' | 'warning' | 'error';
  title: string;
  message: string;
  state: OperationalNotice['state'];
  actionRequired: boolean;
}

interface SyncNotificationChannels {
  success: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
}

export const presentSyncOutcomeFeedback = (
  notice:
    | { channel: 'success' | 'warning' | 'error' | null; title?: string; message?: string }
    | null
    | undefined,
  fallbackTitle: string,
  channels: SyncNotificationChannels
): void => {
  if (!notice?.message || !notice.channel) return;
  channels[notice.channel](notice.title || fallbackTitle, notice.message);
};

const createSyncSuccess = (title: string, message: string): SyncOutcomeFeedback => ({
  channel: 'success',
  title,
  message,
  state: 'ok',
  actionRequired: false,
});

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

const LOCAL_PERSISTENCE_CLAIM =
  /(?:se )?guard(?:ó|aron|ad[oa]s?) localmente|copia local (?:qued[oó]|est[aá]) guardada/i;
const REMOTE_PERSISTENCE_CLAIM =
  /(?:se )?guard(?:ó|aron|ad[oa]s?) en el servidor|confirmad[oa]s? en el servidor/i;

const resolveSyncConsistencyMessage = (
  result: {
    userSafeMessage?: string;
    savedLocally: boolean;
    remoteConfirmed: boolean;
  },
  fallbackMessage: string
): string => {
  const candidate = resolveApplicationOutcomeMessage(result, fallbackMessage);
  if (!result.savedLocally && LOCAL_PERSISTENCE_CLAIM.test(candidate)) {
    return fallbackMessage;
  }
  if (!result.remoteConfirmed && REMOTE_PERSISTENCE_CLAIM.test(candidate)) {
    return fallbackMessage;
  }
  return candidate;
};

const resolveWriteOutcomeFeedback = (
  result: SaveDailyRecordResult | UpdatePartialDailyRecordResult | null | undefined,
  patch: boolean
): SyncOutcomeFeedback | null => {
  if (!result) return null;
  const savedState = resolveDailyRecordSavedState(result);
  const remoteConfirmed = savedState === 'saved';
  const consistencyMessage = (fallbackMessage: string) =>
    resolveSyncConsistencyMessage({ ...result, remoteConfirmed }, fallbackMessage);
  if (isDailyRecordWriteBlockedResult(result) || result.outcome === 'blocked') {
    return createSyncBlocked(
      result.consistencyState === 'blocked_regression'
        ? 'Protección de Datos'
        : result.consistencyState === 'blocked_version_mismatch'
          ? 'Versión de Datos Antigua'
          : patch
            ? 'Actualización bloqueada'
            : 'Guardado bloqueado',
      consistencyMessage(
        patch
          ? 'La actualización fue rechazada y no quedó confirmada.'
          : 'La operación fue rechazada y no quedó confirmada.'
      )
    );
  }
  if (result.outcome === 'queued' && result.savedLocally && result.queuedForRetry) {
    return createSyncRetrying(
      patch ? 'Cambio pendiente de sincronización' : 'Guardado local pendiente',
      patch
        ? 'La actualización quedó guardada localmente y se reintentará la sincronización.'
        : 'Los cambios se guardaron localmente y quedarán pendientes de sincronización.'
    );
  }
  if (result.outcome === 'auto_merged' && result.autoMerged) {
    return createSyncDegraded(
      patch ? 'Cambio actualizado' : 'Censo actualizado',
      'El sistema integró los cambios recientes automáticamente.'
    );
  }
  if (savedState === 'error') {
    return createSyncBlocked(
      patch ? 'Cambio no guardado' : 'Guardado no confirmado',
      patch
        ? 'No fue posible confirmar una copia local ni remota del cambio.'
        : 'No fue posible confirmar una copia local ni remota de los cambios.'
    );
  }
  if (result.outcome === 'unrecoverable' || result.consistencyState === 'unrecoverable') {
    return createSyncDegraded(
      remoteConfirmed
        ? patch
          ? 'Cambio guardado; copia local pendiente'
          : 'Guardado en servidor; copia local pendiente'
        : patch
          ? 'Cambio local sin sincronización'
          : 'Guardado local sin sincronización',
      consistencyMessage(
        remoteConfirmed
          ? patch
            ? 'El cambio quedó confirmado en el servidor, pero la copia local requiere revisión.'
            : 'Los cambios quedaron confirmados en el servidor, pero la copia local requiere revisión.'
          : patch
            ? 'El cambio quedó guardado localmente, pero requiere revisión antes de quedar confirmado.'
            : 'Los cambios quedaron guardados localmente, pero requieren revisión antes de quedar confirmados.'
      )
    );
  }
  return remoteConfirmed
    ? createSyncSuccess(
        patch ? 'Cambio guardado' : 'Censo guardado',
        patch
          ? 'La actualización quedó confirmada en el servidor.'
          : 'Los cambios quedaron confirmados en el servidor.'
      )
    : createSyncDegraded(
        patch ? 'Cambio sólo local' : 'Guardado sólo local',
        patch
          ? 'La actualización quedó guardada en este dispositivo, sin confirmación del servidor.'
          : 'Los cambios quedaron guardados en este dispositivo, sin confirmación del servidor.'
      );
};

export const resolveSaveOutcomeFeedback = (result: SaveDailyRecordResult | null | undefined) =>
  resolveWriteOutcomeFeedback(result, false);

export const resolvePatchOutcomeFeedback = (
  result: UpdatePartialDailyRecordResult | null | undefined
) => resolveWriteOutcomeFeedback(result, true);
