
import { useRef, useEffect } from 'react';

/**
 * Hook to keep a stable reference to a value.
 * Useful for accessing current state in callbacks without adding it to dependencies.
 */
export function useLatest<T>(value: T) {
    const ref = useRef(value);

    useEffect(() => {
        ref.current = value;
    }, [value]);

    return ref;
}
