import React, { useState, useEffect, useRef } from 'react';

interface DebouncedInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'onChange'
> {
  value: string;
  onChange: (value: string) => void;
  debounceMs?: number;
}

/**
 * Input component that maintains local state while typing
 * and only syncs with parent on blur or after debounce delay.
 * This prevents focus loss caused by parent re-renders.
 */
export const DebouncedInput: React.FC<DebouncedInputProps> = ({
  value,
  onChange,
  className,
  debounceMs = 500,
  ...props
}) => {
  const [localValue, setLocalValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // True only when the user has typed (handleChange fired) since the
  // last focus event. Used by handleBlur to decide whether `localValue`
  // is a real pending edit (push) or a stale snapshot from a remote
  // update that arrived while the input was focused (do not push).
  //
  // The bug this guards against: in multi-tab use, browsers do not blur
  // a focused input when the user switches tabs. Tab B can have the
  // diagnosis input focused with localValue="Adenopatias retroperit".
  // Tab A then completes and saves "Adenopatias retroperitoneales en
  // estudio". Subscription updates Tab B's `value` prop, but
  // `localValue` is intentionally preserved while focused. Hours later
  // the user clicks anywhere in Tab B → blur fires → the old code
  // pushed the stale `localValue` back to Firestore, silently
  // truncating the diagnosis. This ref makes the blur push conditional
  // on an actual user edit.
  const hasUserEditedRef = useRef(false);

  // Sync local value with prop when not focused (State derivation pattern)
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue && !isFocused) {
    setLocalValue(value);
    setPrevValue(value);
  }

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    hasUserEditedRef.current = true;

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new debounce timer
    debounceTimerRef.current = setTimeout(() => {
      onChange(newValue);
    }, debounceMs);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(false);

    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (hasUserEditedRef.current && localValue !== value) {
      // Real pending edit the user made during this focus session.
      onChange(localValue);
    } else if (localValue !== value) {
      // The user did not type but localValue diverged from value
      // (a remote update arrived while focused). Adopt the remote
      // value rather than pushing a stale snapshot back.
      setLocalValue(value);
      setPrevValue(value);
    }

    hasUserEditedRef.current = false;

    if (props.onBlur) props.onBlur(e);
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    hasUserEditedRef.current = false;
    if (props.onFocus) props.onFocus(e);
  };

  return (
    <input
      {...props}
      ref={inputRef}
      className={className}
      value={localValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
    />
  );
};
