import { isChunkLoadError } from '@/utils/chunkLoadError';
import type { AppBootstrapRuntimeResult } from '@/app-shell/bootstrap/bootstrapAppRuntime.types';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

type ErrorLikeEventTarget = {
  addEventListener: (
    type: 'error' | 'unhandledrejection',
    listener: EventListenerOrEventListenerObject
  ) => void;
  removeEventListener: (
    type: 'error' | 'unhandledrejection',
    listener: EventListenerOrEventListenerObject
  ) => void;
};

const RECENT_EVENT_MEMORY_LIMIT = 50;
const recentEventKeys: string[] = [];
const recentEventKeySet = new Set<string>();

const isChunkLoadFailureMessage = (message: string): boolean =>
  isChunkLoadError(message) || /cannot access '.+' before initialization/i.test(message);

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return String(error);
};

const rememberEventKey = (key: string): boolean => {
  if (recentEventKeySet.has(key)) {
    return false;
  }

  recentEventKeys.push(key);
  recentEventKeySet.add(key);

  if (recentEventKeys.length > RECENT_EVENT_MEMORY_LIMIT) {
    const oldest = recentEventKeys.shift();
    if (oldest) {
      recentEventKeySet.delete(oldest);
    }
  }

  return true;
};

const recordBootstrapIssue = (
  operation: string,
  runtimeState: 'recoverable' | 'blocked',
  message: string,
  context: Record<string, unknown> = {}
): void => {
  const dedupeKey = `${operation}:${message}`;
  if (!rememberEventKey(dedupeKey)) {
    return;
  }

  recordOperationalTelemetry({
    category: 'auth',
    operation,
    status: runtimeState === 'recoverable' ? 'degraded' : 'failed',
    runtimeState,
    issues: [message],
    context,
  });
};

export const recordBootstrapRuntimeResult = (result: AppBootstrapRuntimeResult): void => {
  if (result.status === 'reload') {
    recordBootstrapIssue(
      'bootstrap_recovery_reload',
      'recoverable',
      'Bootstrap solicito recarga de recuperacion antes de montar la app.',
      {
        stage: result.stage,
        reason: result.clientRecovery.reason,
      }
    );
    return;
  }

  if (result.status !== 'blocked') {
    return;
  }

  const failureMessage = String(result.message || 'La app no pudo iniciar correctamente.');
  const operation = isChunkLoadFailureMessage(getErrorMessage(result.error))
    ? 'bootstrap_chunk_load_failed'
    : 'bootstrap_runtime_failed';

  recordBootstrapIssue(operation, 'blocked', failureMessage, {
    stage: result.stage,
    reason: result.clientRecovery.reason,
  });
};

export const recordBootstrapRuntimeError = (error: unknown): void => {
  const message = getErrorMessage(error);
  const operation = isChunkLoadFailureMessage(message)
    ? 'bootstrap_chunk_load_failed'
    : 'bootstrap_runtime_failed';
  const dedupeKey = `${operation}:${message}`;
  if (!rememberEventKey(dedupeKey)) {
    return;
  }

  recordOperationalErrorTelemetry(
    'auth',
    operation,
    error,
    {
      code: operation,
      message,
      severity: 'error',
      runtimeState: 'blocked',
      userSafeMessage: isChunkLoadFailureMessage(message)
        ? 'No se pudo cargar una parte critica de la aplicacion.'
        : 'La aplicacion no pudo iniciar correctamente.',
    },
    {
      context: {
        phase: 'bootstrap',
      },
    }
  );
};

export const installBootstrapRuntimeErrorListeners = (
  target: ErrorLikeEventTarget = window
): (() => void) => {
  const errorListener: EventListener = event => {
    const runtimeErrorEvent = event as ErrorEvent;
    const error = runtimeErrorEvent.error || runtimeErrorEvent.message || 'window error';
    const message = getErrorMessage(error);
    const operation = isChunkLoadFailureMessage(message)
      ? 'bootstrap_chunk_load_failed'
      : 'bootstrap_window_error';

    recordBootstrapIssue(operation, 'blocked', message, {
      source: 'window.onerror',
      filename: runtimeErrorEvent.filename,
    });
  };

  const rejectionListener: EventListener = event => {
    const rejectionEvent = event as PromiseRejectionEvent;
    const reason = rejectionEvent.reason || 'unhandled rejection';
    const message = getErrorMessage(reason);
    const operation = isChunkLoadFailureMessage(message)
      ? 'bootstrap_chunk_load_failed'
      : 'bootstrap_unhandled_rejection';

    recordBootstrapIssue(operation, 'blocked', message, {
      source: 'window.unhandledrejection',
    });
  };

  target.addEventListener('error', errorListener);
  target.addEventListener('unhandledrejection', rejectionListener);

  return () => {
    target.removeEventListener('error', errorListener);
    target.removeEventListener('unhandledrejection', rejectionListener);
  };
};
