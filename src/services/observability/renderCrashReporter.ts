import type { ErrorInfo } from 'react';

export type RenderCrashReporter = (error: Error, errorInfo: ErrorInfo) => void;

let registeredRenderCrashReporter: RenderCrashReporter | null = null;

/**
 * Registers the runtime sink that receives unhandled React ErrorBoundary crashes.
 * Kept free of storage/data imports so `GlobalErrorBoundary` can report crashes without opening data services.
 */
export const registerRenderCrashReporter = (reporter: RenderCrashReporter): void => {
  registeredRenderCrashReporter = reporter;
};

export const reportRenderCrash = (error: Error, errorInfo: ErrorInfo): void => {
  registeredRenderCrashReporter?.(error, errorInfo);
};
