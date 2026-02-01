/**
 * Optimistic Updates Utility
 * Provides patterns for optimistic UI updates with automatic rollback on failure.
 * 
 * Optimistic updates improve perceived performance by updating the UI immediately
 * before the actual async operation completes, then rolling back if it fails.
 */

import { logger } from '@/services';

// ============================================================================
// Types
// ============================================================================

export interface OptimisticUpdateOptions<T> {
    /** Current state before update */
    currentState: T;

    /** Function to compute the optimistic new state */
    optimisticState: T | ((current: T) => T);

    /** Async function that performs the actual update */
    updateFn: () => Promise<void>;

    /** Called immediately with optimistic state */
    onOptimisticUpdate: (newState: T) => void;

    /** Called on success (optional - state already updated) */
    onSuccess?: () => void;

    /** Called on failure with error, should rollback */
    onError: (error: unknown, previousState: T) => void;
}

export interface OptimisticResult {
    success: boolean;
    error?: unknown;
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Performs an optimistic update with automatic rollback on failure.
 * 
 * @example
 * await performOptimisticUpdate({
 *   currentState: record,
 *   optimisticState: { ...record, beds: updatedBeds },
 *   updateFn: () => saveToFirestore(updatedBeds),
 *   onOptimisticUpdate: setRecord,
 *   onError: (error, previousState) => {
 *     setRecord(previousState);
 *     showError('Failed to save');
 *   }
 * });
 */
export async function performOptimisticUpdate<T>(
    options: OptimisticUpdateOptions<T>
): Promise<OptimisticResult> {
    const {
        currentState,
        optimisticState,
        updateFn,
        onOptimisticUpdate,
        onSuccess,
        onError
    } = options;

    // Compute optimistic state
    const newState = typeof optimisticState === 'function'
        ? (optimisticState as (current: T) => T)(currentState)
        : optimisticState;

    // Apply optimistic update immediately
    onOptimisticUpdate(newState);

    try {
        // Perform actual async operation
        await updateFn();

        logger.debug('OptimisticUpdate', 'Update successful');
        onSuccess?.();

        return { success: true };
    } catch (error) {
        // Rollback on failure
        logger.warn('OptimisticUpdate', 'Rolling back due to error', error);
        onError(error, currentState);

        return { success: false, error };
    }
}

// ============================================================================
// Hook for React
// ============================================================================

import { useCallback, useRef, useState } from 'react';

export interface UseOptimisticStateOptions<T> {
    initialState: T;
    persistFn: (state: T) => Promise<void>;
    onError?: (error: unknown) => void;
}

/**
 * Hook that provides optimistic state management with automatic persistence.
 * 
 * @example
 * const { state, updateOptimistically, isPending, error } = useOptimisticState({
 *   initialState: record,
 *   persistFn: (newRecord) => saveToFirestore(newRecord),
 *   onError: (e) => showNotification('Error saving')
 * });
 */
export function useOptimisticState<T>(options: UseOptimisticStateOptions<T>) {
    const { initialState, persistFn, onError } = options;

    const [state, setState] = useState<T>(initialState);
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const previousStateRef = useRef<T>(initialState);

    const updateOptimistically = useCallback(async (
        updater: T | ((current: T) => T)
    ): Promise<boolean> => {
        // Store previous state for rollback
        previousStateRef.current = state;

        // Compute new state
        const newState = typeof updater === 'function'
            ? (updater as (current: T) => T)(state)
            : updater;

        // Apply optimistically
        setState(newState);
        setIsPending(true);
        setError(null);

        try {
            await persistFn(newState);
            setIsPending(false);
            return true;
        } catch (e) {
            // Rollback
            setState(previousStateRef.current);
            setError(e);
            setIsPending(false);
            onError?.(e);
            return false;
        }
    }, [state, persistFn, onError]);

    const rollback = useCallback(() => {
        setState(previousStateRef.current);
    }, []);

    return {
        state,
        setState,
        updateOptimistically,
        rollback,
        isPending,
        error
    };
}
