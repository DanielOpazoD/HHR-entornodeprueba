import { ErrorSeverity, isRetryableError } from '@/services/utils/errorService';

export type SyncErrorCategory = 'conflict' | 'authorization' | 'validation' | 'network' | 'unknown';

export class ConcurrencyError extends Error {
  constructor(
    message: string,
    readonly reason?: 'version_mismatch' | 'semantic_conflict'
  ) {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

export interface SyncErrorClassification {
  code: string;
  message: string;
  category: SyncErrorCategory;
  severity: ErrorSeverity;
  retryable: boolean;
  recommendedAction: string;
}

const NON_RETRYABLE_CODES = [
  'permission-denied',
  'unauthenticated',
  'invalid-argument',
  'failed-precondition',
] as const;

const normalizeCode = (value: unknown): string => String(value || '').toLowerCase();

const normalizeMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  const value = (error as { message?: unknown })?.message;
  return typeof value === 'string' ? value : String(error || '');
};

const hasNetworkMessage = (message: string): boolean =>
  ['network', 'timeout', 'failed to fetch', 'offline'].some(fragment => message.includes(fragment));

const getCategory = (code: string, messageLower: string, name: string): SyncErrorCategory => {
  if (
    code === 'sync_ack_projection_conflict' ||
    name === 'concurrencyerror' ||
    messageLower.includes('concurrency conflict') ||
    messageLower.includes('modificado por otro usuario')
  ) {
    return 'conflict';
  }
  if (code.includes('permission-denied') || code.includes('unauthenticated')) {
    return 'authorization';
  }
  if (
    code === 'sync_ack_invalid_record' ||
    code === 'sync_ack_missing_projection' ||
    code.includes('invalid-argument') ||
    code.includes('failed-precondition')
  ) {
    return 'validation';
  }
  if (
    code.includes('unavailable') ||
    code.includes('deadline-exceeded') ||
    code.includes('resource-exhausted') ||
    code.includes('aborted') ||
    code.includes('internal') ||
    hasNetworkMessage(messageLower)
  ) {
    return 'network';
  }
  return 'unknown';
};

const getSeverity = (category: SyncErrorCategory): ErrorSeverity =>
  category === 'authorization' ? 'high' : 'medium';

const recommendedActions: Record<SyncErrorCategory, string> = {
  conflict: 'Revisar y resolver conflicto antes de reintentar.',
  authorization: 'Revisar permisos/reglas y sesión del usuario.',
  validation: 'Validar datos antes de reenviar la operación.',
  network: 'Esperar reconexión y reintentar automáticamente.',
  unknown: 'Revisar error y escalar si persiste.',
};

export const classifySyncError = (error: unknown): SyncErrorClassification => {
  const code = normalizeCode((error as { code?: unknown })?.code);
  const message = normalizeMessage(error);
  const messageLower = message.toLowerCase();
  const name = normalizeCode((error as { name?: unknown })?.name);
  const category = getCategory(code, messageLower, name);

  const retryableByCode = !NON_RETRYABLE_CODES.some(nonRetryable => code.includes(nonRetryable));
  const retryableByFallback = isRetryableError(error) || hasNetworkMessage(messageLower);

  return {
    code: code || 'unknown',
    message,
    category,
    severity: getSeverity(category),
    retryable: category !== 'conflict' && retryableByCode && retryableByFallback,
    recommendedAction: recommendedActions[category],
  };
};

export const buildSyncErrorSummary = (classification: SyncErrorClassification): string =>
  `[${classification.category}/${classification.code}] ${classification.message || 'Unknown error'}`;
