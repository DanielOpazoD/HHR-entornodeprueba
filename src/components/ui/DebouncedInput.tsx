import React, { useState, useEffect, useRef } from 'react';


interface DebouncedInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
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

        // Sync immediately on blur if value changed
        if (localValue !== value) {
            onChange(localValue);
        }

        if (props.onBlur) props.onBlur(e);
    };

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
        setIsFocused(true);
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
