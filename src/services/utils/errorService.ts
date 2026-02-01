/**
 * Centralized Error Logging Service
 * Handles error tracking, logging, reporting, and retry logic for Firestore operations
 */

// ============================================================================
// Types and Enums
// ============================================================================

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ErrorLog {
    id: string;
    timestamp: string;
    message: string;
    severity: ErrorSeverity;
    stack?: string;
    userId?: string;
    userEmail?: string;
    context?: Record<string, unknown>;
    userAgent?: string;
    url?: string;
}

export interface RetryConfig {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    retryableErrors: string[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 500,
    maxDelayMs: 5000,
    retryableErrors: [
        'unavailable',
        'resource-exhausted',
        'aborted',
        'internal',
        'deadline-exceeded',
    ],
};

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
            const errorCode = (error as { code?: string })?.code || '';
            const isRetryable = config.retryableErrors.some(code => errorCode.includes(code));

            if (!isRetryable || attempt > config.maxRetries) {
                throw error;
            }

            // Calculate delay with exponential backoff + jitter
            const delay = Math.min(
                config.baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 100,
                config.maxDelayMs
            );

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
    const errorCode = (error as { code?: string })?.code || '';
    return DEFAULT_RETRY_CONFIG.retryableErrors.some(code => errorCode.includes(code));
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
        window.addEventListener('unhandledrejection', (event) => {
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
        window.addEventListener('error', (event) => {
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
    logError(params: {
        message: string;
        severity?: ErrorSeverity;
        error?: Error | unknown;
        stack?: string;
        context?: Record<string, unknown>;
        userId?: string;
        userEmail?: string;
    }): void {
        const errorLog: ErrorLog = {
            id: this.generateErrorId(),
            timestamp: new Date().toISOString(),
            message: params.message,
            severity: params.severity || 'medium',
            stack: params.stack || (params.error instanceof Error ? params.error.stack : undefined),
            userId: params.userId,
            userEmail: params.userEmail,
            context: params.context,
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
            url: typeof window !== 'undefined' ? window.location.href : undefined,
        };

        // Store locally
        this.errors.push(errorLog);
        if (this.errors.length > this.maxLocalErrors) {
            this.errors.shift(); // Remove oldest
        }

        // Log to console in development
        if (import.meta.env.DEV) {
            console.error('[ErrorService]', errorLog);
        }

        // Send to external service (Sentry, LogRocket, etc.) - Future
        this.sendToExternalService(errorLog);

        // Store in IndexedDB for the local Error Dashboard (unlimited capacity)
        import('../storage/indexedDBService').then(({ saveErrorLog }) => {
            saveErrorLog(errorLog);
        }).catch(err => console.error('Failed to log to IndexedDB:', err));
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
        const err = error as { code?: string };
        const firebaseErrorCode = err?.code || 'unknown';
        const message = `Firebase ${operation} failed: ${firebaseErrorCode}`;

        this.logError({
            message,
            severity: this.getFirebaseErrorSeverity(firebaseErrorCode),
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
        const err = error as { code?: string; message?: string; name?: string };
        // Firebase auth errors
        if (err?.code?.startsWith('auth/')) {
            return this.getFirebaseAuthMessage(err.code);
        }

        // Firebase Firestore errors
        if (err?.code?.startsWith('permission-denied')) {
            return 'No tiene permisos para realizar esta acción';
        }

        if (err?.code === 'unavailable') {
            return 'Servicio temporalmente no disponible. Por favor, intente más tarde.';
        }

        // Network errors
        if (err?.message?.includes('network') || err?.message?.includes('fetch')) {
            return 'Error de conexión. Verifique su conexión a internet.';
        }

        // Validation errors
        if (err?.name === 'ZodError') {
            return 'Los datos ingresados no son válidos. Por favor, revise los campos.';
        }

        // Default
        return 'Ha ocurrido un error. Por favor, intente nuevamente.';
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

    // ============================================
    // PRIVATE METHODS
    // ============================================

    private generateErrorId(): string {
        return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private getFirebaseErrorSeverity(code: string): ErrorSeverity {
        if (code.includes('permission-denied')) return 'high';
        if (code.includes('not-found')) return 'medium';
        if (code.includes('unavailable')) return 'critical';
        if (code.includes('unauthenticated')) return 'medium';
        return 'medium';
    }

    private getFirebaseAuthMessage(code: string): string {
        const messages: Record<string, string> = {
            'auth/invalid-email': 'Email inválido',
            'auth/user-disabled': 'Usuario deshabilitado',
            'auth/user-not-found': 'Usuario no encontrado',
            'auth/wrong-password': 'Contraseña incorrecta',
            'auth/email-already-in-use': 'Email ya está en uso',
            'auth/weak-password': 'Contraseña muy débil',
            'auth/network-request-failed': 'Error de red. Verifique su conexión.',
            'auth/too-many-requests': 'Demasiados intentos. Intente más tarde.',
        };

        return messages[code] || 'Error de autenticación';
    }


    private async sendToExternalService(error: ErrorLog): Promise<void> {
        // Only log high or critical errors to remote audit
        if (error.severity === 'high' || error.severity === 'critical') {
            try {
                // Dynamic import to avoid circular dependencies or init issues
                const { logSystemError } = await import('../admin/auditService');

                await logSystemError(
                    error.message,
                    error.severity,
                    {
                        stack: error.stack,
                        context: error.context,
                        url: error.url,
                        userAgent: error.userAgent,
                        originalErrorId: error.id
                    }
                );
            } catch (err) {
                console.error('[ErrorService] Failed to send to audit log:', err);
            }
        }
    }
}

// Export singleton instance
export const errorService = ErrorService.getInstance();

// Export helper function for easy access
export const logError = (
    message: string,
    error?: Error,
    context?: Record<string, unknown>
) => {
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
