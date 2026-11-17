import { useLayoutEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

/**
 * A ref that holds the value of the last committed render, for callbacks and effects.
 * It updates during the commit, so a promise or timer that resolves right after it, and the
 * effects of child components, already read the new value; a render that React discards
 * never reaches it.
 */
export const useLatestRef = <T>(value: T): MutableRefObject<T> => {
  const ref = useRef(value);

  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
};
