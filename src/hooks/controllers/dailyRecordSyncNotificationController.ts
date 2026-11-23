import { ConcurrencyError } from '@/services/storage/firestore/firestoreRecordWrites';
import { FIELD_CHANGED_ELSEWHERE_MESSAGE } from '@/services/storage/syncErrorCatalog';
import { DataRegressionError, VersionMismatchError } from '@/utils/integrityGuard';
import { resolveApplicationOutcomeMessage } from '@/shared/contracts/applicationOutcomeMessage';
import { AdmissionDatePolicyViolationError } from '@/domain/clinical-episode/admissionDatePolicy';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';
import {
  createBlockedNotice,
  createDegradedNotice,
  createRetryingNotice,
  type OperationalNotice,
} from '@/shared/feedback/operationalNoticePolicy';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import type { OPERATIONAL_TELEMETRY_SYNC_NOTICE_KINDS } from '@/shared/observability/operationalTelemetryPrivacy';

/** Which sync notice a save or an update showed; the production log counts it by this value. */
export type SyncNoticeKind = (typeof OPERATIONAL_TELEMETRY_SYNC_NOTICE_KINDS)[number];

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
  /** Absent only on the routine confirmation, which is not counted. */
  kind?: SyncNoticeKind;
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
    | {
        channel: 'success' | 'warning' | 'error' | null;
        kind?: SyncNoticeKind;
        title?: string;
        message?: string;
      }
    | null
    | undefined,
  fallbackTitle: string,
  channels: SyncNotificationChannels
): void => {
  if (!notice?.message || !notice.channel) return;
  channels[notice.channel](notice.title || fallbackTitle, notice.message);
  // Counted as `degraded`, never `failed`: a notice already on screen is not mailed as well.
  if (notice.kind)
    recordOperationalTelemetry({
      category: 'daily_record',
      status: 'degraded',
      operation: 'daily_record_sync_notice',
      context: { noticeKind: notice.kind },
    });
};

const createSyncSuccess = (title: string, message: string): SyncOutcomeFeedback => ({
  channel: 'success',
  title,
  message,
  state: 'ok',
  actionRequired: false,
});

const createSyncRetrying = (
  kind: SyncNoticeKind,
  title: string,
  message: string
): SyncOutcomeFeedback => ({
  ...createRetryingNotice(title, message),
  channel: 'warning',
  kind,
});

const createSyncDegraded = (
  kind: SyncNoticeKind,
  title: string,
  message: string
): SyncOutcomeFeedback => ({
  ...createDegradedNotice(title, message),
  channel: 'warning',
  kind,
});

const createSyncBlocked = (
  kind: SyncNoticeKind,
  title: string,
  message: string
): SyncOutcomeFeedback => ({
  ...createBlockedNotice(title, message),
  channel: 'error',
  kind,
});

const LOCAL_PERSISTENCE_CLAIM =
  /(?:se )?guard(?:ó|aron|ad[oa]s?) localmente|copia local (?:qued[oó]|est[aá]) guardada/i;
const REMOTE_PERSISTENCE_CLAIM =
  /(?:se )?guard(?:ó|aron|ad[oa]s?) en el servidor|confirmad[oa]s? en el servidor/i;

const resolveSyncConsistencyMessage = (
  result: {
    userSafeMessage?: string;
    savedHere: boolean;
    remoteConfirmed: boolean;
  },
  fallbackMessage: string
): string => {
  const candidate = resolveApplicationOutcomeMessage(result, fallbackMessage);
  if (!result.savedHere && LOCAL_PERSISTENCE_CLAIM.test(candidate)) {
    return fallbackMessage;
  }
  if (!result.remoteConfirmed && REMOTE_PERSISTENCE_CLAIM.test(candidate)) {
    return fallbackMessage;
  }
  return candidate;
};

const notSavedFeedback = (patch: boolean) =>
  createSyncBlocked(
    'not_saved',
    patch ? 'Cambio no guardado' : 'Guardado no confirmado',
    patch
      ? 'No fue posible confirmar una copia local ni remota del cambio.'
      : 'No fue posible confirmar una copia local ni remota de los cambios.'
  );

const resolveWriteOutcomeFeedback = (
  result: DailyRecordWriteResult | null | undefined,
  patch: boolean
): SyncOutcomeFeedback | null => {
  if (!result) return null;
  const remoteConfirmed = result.state === 'confirmed';
  const consistencyMessage = (fallbackMessage: string) =>
    resolveSyncConsistencyMessage({ ...result, remoteConfirmed }, fallbackMessage);
  switch (result.state) {
    case 'not_saved':
      // Work of a departed session is not shown to the next one.
      if (result.reason === 'session_changed') return null;
      if (result.reason === 'blocked') {
        return createSyncBlocked(
          'blocked',
          result.blockingError instanceof DataRegressionError
            ? 'Protección de Datos'
            : result.blockingError instanceof VersionMismatchError
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
      return notSavedFeedback(patch);
    case 'held':
      if (result.reason === 'session_changed') return null;
      if (result.reason === 'field_changed_elsewhere') {
        // Nothing was integrated: the edit waits for review with this device's text.
        return createSyncDegraded(
          'pending_review',
          patch ? 'Cambio pendiente de revisión' : 'Censo pendiente de revisión',
          consistencyMessage(FIELD_CHANGED_ELSEWHERE_MESSAGE)
        );
      }
      return createSyncDegraded(
        'unrecoverable',
        patch ? 'Cambio local sin sincronización' : 'Guardado local sin sincronización',
        consistencyMessage(
          patch
            ? 'El cambio quedó guardado localmente, pero requiere revisión antes de quedar confirmado.'
            : 'Los cambios quedaron guardados localmente, pero requieren revisión antes de quedar confirmados.'
        )
      );
    case 'confirmed':
      if (result.localCopy === 'stale') {
        return createSyncDegraded(
          'unrecoverable',
          patch
            ? 'Cambio guardado; copia local pendiente'
            : 'Guardado en servidor; copia local pendiente',
          consistencyMessage(
            patch
              ? 'El cambio quedó confirmado en el servidor, pero la copia local requiere revisión.'
              : 'Los cambios quedaron confirmados en el servidor, pero la copia local requiere revisión.'
          )
        );
      }
      return createSyncSuccess(
        patch ? 'Cambio guardado' : 'Censo guardado',
        patch
          ? 'La actualización quedó confirmada en el servidor.'
          : 'Los cambios quedaron confirmados en el servidor.'
      );
    case 'local':
      // Without a recorded copy the sync box says error, so the notice says the same.
      if (!result.savedHere) return notSavedFeedback(patch);
      // Routine: the day's queue task saves it right away, and the sync status shows it pending.
      if (result.cause === 'queue_route') return null;
      if (result.cause === 'merged') {
        return createSyncDegraded(
          'auto_merged',
          patch ? 'Cambio actualizado' : 'Censo actualizado',
          'El sistema integró los cambios recientes automáticamente.'
        );
      }
      if (result.cause === 'retrying') {
        return createSyncRetrying(
          'pending_sync',
          patch ? 'Cambio pendiente de sincronización' : 'Guardado local pendiente',
          patch
            ? 'La actualización quedó guardada localmente y se reintentará la sincronización.'
            : 'Los cambios se guardaron localmente y quedarán pendientes de sincronización.'
        );
      }
      return createSyncDegraded(
        'local_only',
        patch ? 'Cambio sólo local' : 'Guardado sólo local',
        patch
          ? 'La actualización quedó guardada en este dispositivo, sin confirmación del servidor.'
          : 'Los cambios quedaron guardados en este dispositivo, sin confirmación del servidor.'
      );
  }
};

export const resolveSaveOutcomeFeedback = (result: DailyRecordWriteResult | null | undefined) =>
  resolveWriteOutcomeFeedback(result, false);

export const resolvePatchOutcomeFeedback = (result: DailyRecordWriteResult | null | undefined) =>
  resolveWriteOutcomeFeedback(result, true);
