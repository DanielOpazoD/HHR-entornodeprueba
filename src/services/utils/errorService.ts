import { ErrorLog, ErrorSeverity, LogLevel } from '@/services/logging/errorLogTypes';
import {
  buildErrorLog,
  buildRetryDelayMs,
  classifyErrorForService,
  DEFAULT_RETRY_CONFIG,
  getFirebaseErrorSeverity,
  getUserFriendlyErrorMessage as getUserFriendlyErrorMessageFromController,
  isRetryableError as isRetryableErrorFromController,
  type BuildErrorLogParams,
  type RetryConfig,
} from '@/services/utils/errorServiceController';
import {
  buildDefaultErrorServiceSinks,
  runErrorServiceSinks,
} from '@/services/utils/errorServiceSinks';

export type { ErrorLog, ErrorSeverity, LogLevel, RetryConfig };

// ============================================================================
// Retry Logic Utility
// ============================================================================

/**
 * Wraps an async function with exponential backoff retry logic.
 * Useful for Firestore operations that may fail due to network issues.
 *
 * @example
 * const result = await withRetry(() => saveToFirestore(data), {
 *   maxRetries: 3,
 *   onRetry: (attempt, error) => console.debug(`Retry ${attempt}...`)
 * });
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    config?: Partial<RetryConfig>;
    onRetry?: (attempt: number, error: unknown) => void;
  } = {}
): Promise<T> {
  const config = { ...DEFAULT_RETRY_CONFIG, ...options.config };
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      // Check if error is retryable
      const isRetryable = isRetryableErrorFromController(error, config.retryableErrors);

      if (!isRetryable || attempt > config.maxRetries) {
        throw error;
      }

      // Calculate delay with exponential backoff + jitter
      const delay = buildRetryDelayMs(attempt, config);

      options.onRetry?.(attempt, error);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Check if an error is retryable based on its code
 */
export function isRetryableError(error: unknown): boolean {
  return isRetryableErrorFromController(error);
}

class ErrorService {
  private static instance: ErrorService;
  private errors: ErrorLog[] = [];
  private maxLocalErrors = 100; // Keep last 100 errors locally

  private constructor() {
    // Set up global error handlers
    this.setupGlobalHandlers();
  }

  static getInstance(): ErrorService {
    if (!ErrorService.instance) {
      ErrorService.instance = new ErrorService();
    }
    return ErrorService.instance;
  }

  private setupGlobalHandlers() {
    if (typeof window === 'undefined') return;
    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', event => {
      this.logError({
        message: `Unhandled Promise Rejection: ${event.reason}`,
        severity: 'high',
        stack: event.reason?.stack,
        context: {
          type: 'unhandledrejection',
          reason: event.reason,
        },
      });
    });

    // Handle global errors
    window.addEventListener('error', event => {
      this.logError({
        message: event.message || 'Unknown error',
        severity: 'high',
        stack: event.error?.stack,
        context: {
          type: 'error',
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      });
    });
  }

  /**
   * Records an error entry in the service.
   * Logged errors are kept in memory and critical/high severity errors
   * are persisted to local storage for persistent tracking.
   *
   * @param params - Object containing error details (message, error, context)
   */
  logError(params: BuildErrorLogParams): void {
    const errorLog = buildErrorLog(params);

    // Store locally
    this.errors.push(errorLog);
    if (this.errors.length > this.maxLocalErrors) {
      this.errors.shift(); // Remove oldest
    }

    void runErrorServiceSinks(
      errorLog,
      buildDefaultErrorServiceSinks({ allowDevConsole: import.meta.env.DEV })
    );
  }

  /**
   * Convenient method for logging errors originating from Firebase services.
   * Automatically assigns severity based on the Firebase error code.
   *
   * @param error - The error object from Firebase
   * @param operation - A string describing the failed operation (e.g., 'saveRecord')
   * @param context - Additional debugging information
   */
  logFirebaseError(error: unknown, operation: string, context?: Record<string, unknown>): void {
    const classification = classifyErrorForService(error);
    const firebaseErrorCode = classification.code || 'unknown';
    const message = `Firebase ${operation} failed: ${firebaseErrorCode}`;

    this.logError({
      message,
      severity: getFirebaseErrorSeverity(firebaseErrorCode) || classification.severity,
      error,
      context: {
        operation,
        firebaseCode: firebaseErrorCode,
        ...context,
      },
    });
  }

  /**
   * Log validation error
   */
  logValidationError(fieldName: string, error: unknown, context?: Record<string, unknown>): void {
    this.logError({
      message: `Validation failed for ${fieldName}`,
      severity: 'low',
      error,
      context: {
        fieldName,
        validationError: error,
        ...context,
      },
    });
  }

  /**
   * Converts a technical error into a human-readable message in Spanish.
   * Useful for displaying end-user notifications.
   *
   * @param error - Technical error object
   * @returns A friendly message suitable for user-facing UI
   */
  getUserFriendlyMessage(error: unknown): string {
    return (
      classifyErrorForService(error).userFriendlyMessage ||
      getUserFriendlyErrorMessageFromController(error)
    );
  }

  /**
   * Get all errors (for admin debugging)
   */
  getAllErrors(): ErrorLog[] {
    return [...this.errors];
  }

  /**
   * Clear all errors
   */
  clearErrors(): void {
    this.errors = [];
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('criticalErrors');
    }
  }
}

// Export singleton instance
export const errorService = ErrorService.getInstance();

// Export helper function for easy access
export const logError = (message: string, error?: Error, context?: Record<string, unknown>) => {
  errorService.logError({ message, error, context });
};

export const logFirebaseError = (
  error: unknown,
  operation: string,
  context?: Record<string, unknown>
) => {
  errorService.logFirebaseError(error, operation, context);
};

export const getUserFriendlyErrorMessage = (error: unknown): string => {
  return errorService.getUserFriendlyMessage(error);
};
