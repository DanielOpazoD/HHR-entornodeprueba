/**
 * Network Utilities
 * Provides resilient network patterns like exponential backoff retries.
 */

import { createScopedLogger } from '@/services/utils/loggerScope';

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  factor?: number;
  onRetry?: (error: unknown, attempt: number, delay: number) => void;
  /** Return false to abort retries immediately and rethrow the error. */
  shouldRetry?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'shouldRetry'>> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  factor: 2,
};

const networkUtilsLogger = createScopedLogger('NetworkUtils');

/**
 * Executes an asynchronous function with automatic retry logic and exponential backoff.
 *
 * @param fn - The asynchronous function to execute
 * @param options - Configuration for the retry behavior
 * @returns The result of the function execution
 * @throws The last error encountered if all retries fail
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxRetries, initialDelay, maxDelay, factor } = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  let lastError: unknown;
  let currentDelay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on last attempt or when caller opts out
      if (attempt === maxRetries) break;
      if (options.shouldRetry && !options.shouldRetry(error)) break;

      // Log or notify about the retry attempt
      if (options.onRetry) {
        options.onRetry(error, attempt + 1, currentDelay);
      } else {
        networkUtilsLogger.warn('Retrying failed network operation', {
          attempt: attempt + 1,
          delayMs: currentDelay,
          error,
        });
      }

      // Wait for the specified delay before next attempt
      await new Promise(resolve => setTimeout(resolve, currentDelay));

      // Calculate next delay with exponential backoff
      currentDelay = Math.min(currentDelay * factor, maxDelay);
    }
  }

  throw lastError;
}
