import React, { useState, useEffect, useRef, useCallback } from 'react';

interface DebouncedTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    value: string;
    onChangeValue: (value: string) => void;
    debounceMs?: number;
    minRows?: number;
}

/**
 * Textarea component that maintains local state while typing
 * and only syncs with parent after a debounce delay or on blur.
 * Features auto-resizing height based on content.
 */
export const DebouncedTextarea: React.FC<DebouncedTextareaProps> = ({
    value,
    onChangeValue,
    className = '',
    debounceMs = 1000,
    minRows = 2,
    ...props
}) => {
    const [localValue, setLocalValue] = useState(value);
    const [isFocused, setIsFocused] = useState(false);
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-resize function
    const resizeTextarea = useCallback(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            const lineHeight = 20;
            const minHeight = lineHeight * minRows;
            textarea.style.height = `${Math.max(textarea.scrollHeight, minHeight)}px`;
        }
    }, [minRows]);

    // Sync local value with prop when not focused (State derivation pattern)
    const [prevValue, setPrevValue] = useState(value);
    if (value !== prevValue && !isFocused) {
        setLocalValue(value);
        setPrevValue(value);
    }

    // Trigger resize on value change
    useEffect(() => {
        resizeTextarea();
    }, [localValue, resizeTextarea]);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        setLocalValue(newValue);

        // Clear existing timer
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        // Set new debounce timer
        debounceTimerRef.current = setTimeout(() => {
            onChangeValue(newValue);
        }, debounceMs);
    };

    const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
        setIsFocused(false);

        // Clear any pending debounce and sync immediately
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }

        if (localValue !== value) {
            onChangeValue(localValue);
        }

        if (props.onBlur) props.onBlur(e);
    };

    const handleFocus = (e: React.FocusEvent<HTMLTextAreaElement>) => {
        setIsFocused(true);
        if (props.onFocus) props.onFocus(e);
    };

    return (
        <textarea
            {...props}
            ref={textareaRef}
            className={`overflow-hidden resize-none ${className}`}
            value={localValue}
            onChange={handleChange}
            onBlur={handleBlur}
            onFocus={handleFocus}
            rows={minRows}
        />
    );
};
