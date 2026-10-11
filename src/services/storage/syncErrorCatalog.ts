import { ErrorSeverity, isRetryableError } from '@/services/utils/errorService';

export type SyncErrorCategory = 'conflict' | 'authorization' | 'validation' | 'network' | 'unknown';

export class ConcurrencyError extends Error {
  constructor(message: string) {
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

const getCategory = (code: string, messageLower: string, name: string): SyncErrorCategory => {
  if (
    name === 'concurrencyerror' ||
    messageLower.includes('concurrency conflict') ||
    messageLower.includes('modificado por otro usuario')
  ) {
    return 'conflict';
  }
  if (code.includes('permission-denied') || code.includes('unauthenticated')) {
    return 'authorization';
  }
  if (code.includes('invalid-argument') || code.includes('failed-precondition')) {
    return 'validation';
  }
  if (
    code.includes('unavailable') ||
    code.includes('deadline-exceeded') ||
    code.includes('resource-exhausted') ||
    code.includes('aborted') ||
    code.includes('internal') ||
    messageLower.includes('network') ||
    messageLower.includes('timeout') ||
    messageLower.includes('failed to fetch') ||
    messageLower.includes('offline')
  ) {
    return 'network';
  }
  return 'unknown';
};

const getSeverity = (category: SyncErrorCategory): ErrorSeverity => {
  switch (category) {
    case 'authorization':
      return 'high';
    case 'validation':
      return 'medium';
    case 'network':
      return 'medium';
    case 'conflict':
      return 'medium';
    default:
      return 'medium';
  }
};

const getRecommendedAction = (category: SyncErrorCategory): string => {
  switch (category) {
    case 'conflict':
      return 'Revisar y resolver conflicto antes de reintentar.';
    case 'authorization':
      return 'Revisar permisos/reglas y sesión del usuario.';
    case 'validation':
      return 'Validar datos antes de reenviar la operación.';
    case 'network':
      return 'Esperar reconexión y reintentar automáticamente.';
    default:
      return 'Revisar error y escalar si persiste.';
  }
};

export const classifySyncError = (error: unknown): SyncErrorClassification => {
  const code = normalizeCode((error as { code?: unknown })?.code);
  const message = normalizeMessage(error);
  const messageLower = message.toLowerCase();
  const name = normalizeCode((error as { name?: unknown })?.name);
  const category = getCategory(code, messageLower, name);

  const retryableByCode = !NON_RETRYABLE_CODES.some(nonRetryable => code.includes(nonRetryable));
  const retryableByFallback =
    isRetryableError(error) ||
    messageLower.includes('network') ||
    messageLower.includes('timeout') ||
    messageLower.includes('failed to fetch') ||
    messageLower.includes('offline');

  return {
    code: code || 'unknown',
    message,
    category,
    severity: getSeverity(category),
    retryable: category !== 'conflict' && retryableByCode && retryableByFallback,
    recommendedAction: getRecommendedAction(category),
  };
};

export const buildSyncErrorSummary = (classification: SyncErrorClassification): string =>
  `[${classification.category}/${classification.code}] ${classification.message || 'Unknown error'}`;
