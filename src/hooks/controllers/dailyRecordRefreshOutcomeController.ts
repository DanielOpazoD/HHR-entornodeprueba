import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type { SyncOutcome } from '@/application/daily-record/syncDailyRecordUseCase';
import { resolveApplicationOutcomeMessage } from '@/shared/contracts/applicationOutcomeMessage';
import {
  createBlockedNotice,
  createDegradedNotice,
  createRetryingNotice,
  type OperationalNotice,
} from '@/shared/feedback/operationalNoticePolicy';

export interface DailyRecordRefreshOutcomePresentation {
  channel: 'warning' | 'error' | null;
  title?: string;
  message?: string;
  state?: OperationalNotice['state'];
  actionRequired?: boolean;
  actionLabel?: string;
  runbook?: string;
}

const resolveSyncConflictTitle = (outcome: ApplicationOutcome<SyncOutcome>): string => {
  if (outcome.data.conflict?.kind === 'remote_blocked') {
    return 'Sincronización remota bloqueada';
  }

  if (outcome.data.conflict?.kind === 'missing_remote_record') {
    return 'Registro remoto no disponible';
  }

  return outcome.status === 'failed'
    ? 'Sincronización fallida'
    : 'Sincronización con observaciones';
};

const resolveSyncConflictAction = (
  outcome: ApplicationOutcome<SyncOutcome>
): string | undefined => {
  switch (outcome.data.conflict?.recommendedAction) {
    case 'continue_with_local_copy':
      return 'Puedes seguir usando la copia local mientras revisas el bloqueo remoto.';
    case 'review_remote_record':
      return 'Revisa el registro remoto antes de reintentar la sincronización.';
    case 'retry_sync':
      return 'Intenta sincronizar nuevamente.';
    case 'escalate_support':
      return 'Escala el incidente usando el runbook de sync.';
    default:
      return undefined;
  }
};

export const presentDailyRecordRefreshOutcome = (
  outcome: ApplicationOutcome<SyncOutcome>
): DailyRecordRefreshOutcomePresentation => {
  if (outcome.status === 'partial' || outcome.status === 'degraded') {
    const actionLabel = resolveSyncConflictAction(outcome);
    const message = resolveApplicationOutcomeMessage(
      outcome,
      outcome.status === 'partial'
        ? 'La sincronización quedó pendiente.'
        : 'La sincronización continúa con limitaciones.'
    );
    const notice =
      outcome.data.conflict?.recommendedAction === 'retry_sync'
        ? createRetryingNotice(resolveSyncConflictTitle(outcome), message)
        : createDegradedNotice(resolveSyncConflictTitle(outcome), message);
    return {
      ...notice,
      channel: 'warning',
      message: [notice.message, actionLabel].filter(Boolean).join(' '),
      actionLabel,
      runbook: outcome.data.conflict?.runbook,
    };
  }

  if (outcome.status === 'failed') {
    const actionLabel = resolveSyncConflictAction(outcome);
    const message = resolveApplicationOutcomeMessage(
      outcome,
      'No se pudo sincronizar el registro.'
    );
    const notice =
      outcome.data.conflict?.recommendedAction === 'retry_sync'
        ? createRetryingNotice(resolveSyncConflictTitle(outcome), message)
        : createBlockedNotice(resolveSyncConflictTitle(outcome), message);
    return {
      ...notice,
      channel: notice.channel === 'info' ? 'warning' : notice.channel,
      message: [notice.message, actionLabel].filter(Boolean).join(' '),
      actionLabel,
      runbook: outcome.data.conflict?.runbook,
    };
  }

  return { channel: null };
};
