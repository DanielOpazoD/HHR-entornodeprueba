import type { MutableRefObject } from 'react';
import { useLatestRef } from './useLatestRef';

/**
 * Backward-compatible alias for useLatestRef.
 */
export const useLatest = <T>(value: T): MutableRefObject<T> => useLatestRef(value);
