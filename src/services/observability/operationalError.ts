import type { OperationalRuntimeState } from '@/services/observability/operationalRuntimeState';

export type OperationalErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface OperationalErrorShape {
  code: string;
  message: string;
  severity: OperationalErrorSeverity;
  runtimeState?: OperationalRuntimeState;
  context?: Record<string, unknown>;
  userSafeMessage?: string;
}

export class OperationalError extends Error implements OperationalErrorShape {
  code: string;
  severity: OperationalErrorSeverity;
  runtimeState?: OperationalRuntimeState;
  context?: Record<string, unknown>;
  userSafeMessage?: string;

  constructor(input: OperationalErrorShape) {
    super(input.message);
    this.name = 'OperationalError';
    this.code = input.code;
    this.severity = input.severity;
    this.runtimeState = input.runtimeState;
    this.context = input.context;
    this.userSafeMessage = input.userSafeMessage;
  }
}

export const createOperationalError = (input: OperationalErrorShape): OperationalError =>
  new OperationalError(input);

export const normalizeOperationalError = (
  error: unknown,
  fallback: OperationalErrorShape
): OperationalError => {
  if (error instanceof OperationalError) {
    return error;
  }

  if (error instanceof Error) {
    return createOperationalError({
      ...fallback,
      message: error.message || fallback.message,
      context: {
        ...fallback.context,
        originalName: error.name,
      },
    });
  }

  return createOperationalError({
    ...fallback,
    context: {
      ...fallback.context,
      originalValue: String(error),
    },
  });
};
