/**
 * Network Utilities
 * Provides resilient network patterns like exponential backoff retries.
 */

export interface RetryOptions {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    factor?: number;
    onRetry?: (error: unknown, attempt: number, delay: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    factor: 2
};

/**
 * Executes an asynchronous function with automatic retry logic and exponential backoff.
 * 
 * @param fn - The asynchronous function to execute
 * @param options - Configuration for the retry behavior
 * @returns The result of the function execution
 * @throws The last error encountered if all retries fail
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const { maxRetries, initialDelay, maxDelay, factor } = {
        ...DEFAULT_OPTIONS,
        ...options
    };

    let lastError: unknown;
    let currentDelay = initialDelay;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // Don't retry on last attempt
            if (attempt === maxRetries) break;

            // Log or notify about the retry attempt
            if (options.onRetry) {
                options.onRetry(error, attempt + 1, currentDelay);
            } else {
                console.warn(
                    `[networkUtils] Attempt ${attempt + 1} failed. Retrying in ${currentDelay}ms...`,
                    error
                );
            }

            // Wait for the specified delay before next attempt
            await new Promise(resolve => setTimeout(resolve, currentDelay));

            // Calculate next delay with exponential backoff
            currentDelay = Math.min(currentDelay * factor, maxDelay);
        }
    }

    throw lastError;
}
