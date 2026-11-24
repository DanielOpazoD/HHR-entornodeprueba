import type { ErrorInfo } from 'react';
import { isChunkLoadError } from '@/utils/chunkLoadError';

export type RenderCrashReporter = (error: Error, errorInfo: ErrorInfo) => void;

interface CaughtRenderErrorInfo {
  componentStack?: string;
}

let registeredRenderCrashReporter: RenderCrashReporter | null = null;

/**
 * Registers the runtime sink that receives React ErrorBoundary crashes.
 * Kept free of storage/data imports so `src/index.tsx` can wire `onCaughtError` without pulling data services into the entry chunk.
 */
export const registerRenderCrashReporter = (reporter: RenderCrashReporter): void => {
  registeredRenderCrashReporter = reporter;
};

/**
 * React 19 `createRoot` `onCaughtError` handler: reports crashes caught by any ErrorBoundary
 * (`GlobalErrorBoundary`, `SectionErrorBoundary`, `react-error-boundary`, etc.) to `errorService`.
 */
export const reportCaughtRenderError = (
  error: unknown,
  errorInfo: CaughtRenderErrorInfo = {}
): void => {
  if (import.meta.env.DEV) {
    console.error(error, errorInfo.componentStack);
  }
  if (isChunkLoadError(error)) {
    return;
  }
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  registeredRenderCrashReporter?.(normalizedError, {
    componentStack: errorInfo.componentStack,
  });
};
