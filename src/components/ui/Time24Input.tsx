import React, { useState } from 'react';
import { useChangedOnRender } from '@/hooks/useChangedOnRender';

const VALID_24H_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Normalizes user-entered 24-hour clock drafts (e.g. `2200`, `9:5`, `9`) to `HH:mm`. */
export const normalizeTime24Input = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/[^\d:\s]/.test(trimmed)) return null;
  if (VALID_24H_TIME.test(trimmed)) return trimmed;

  const colonMatch = /^(\d{1,2}):(\d{1,2})$/.exec(trimmed);
  if (colonMatch) {
    const hours = Number(colonMatch[1]);
    const minutes = Number(colonMatch[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
    return null;
  }

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 4) {
    const hours = Number(digits.slice(0, 2));
    const minutes = Number(digits.slice(2, 4));
    if (hours <= 23 && minutes <= 59) {
      return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
    }
    return null;
  }
  if (digits.length === 3) {
    const hours = Number(digits.slice(0, 1));
    const minutes = Number(digits.slice(1, 3));
    if (hours <= 9 && minutes <= 59) {
      return `0${digits.slice(0, 1)}:${digits.slice(1, 3)}`;
    }
    return null;
  }
  if (digits.length === 1 || digits.length === 2) {
    const hours = Number(digits);
    if (hours >= 0 && hours <= 23) {
      return `${String(hours).padStart(2, '0')}:00`;
    }
    return null;
  }
  return null;
};

const formatLiveDraft = (nextRaw: string, previousDraft: string): string => {
  const cleaned = nextRaw.replace(/[^\d:]/g, '');
  if (cleaned.includes(':')) {
    const [h = '', m = ''] = cleaned.split(':');
    return `${h.slice(0, 2)}:${m.slice(0, 2)}`;
  }
  const digits = cleaned.slice(0, 4);
  if (digits.length > 2) {
    return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  }
  if (digits.length === 2 && previousDraft.length < nextRaw.length) {
    return `${digits}:`;
  }
  return digits;
};

export interface Time24InputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'step'
> {
  value: string;
  onValueChange: (value: string) => void;
  maxTime?: string;
}

/**
 * 24-hour clock input (`HH:mm`, 00:00–23:59) that never renders locale-dependent `a. m.` / `p. m.`
 * suffixes regardless of OS or browser settings.
 */
export const Time24Input: React.FC<Time24InputProps> = ({
  value,
  onValueChange,
  maxTime,
  placeholder = '22:00',
  onBlur,
  ...rest
}) => {
  const [draft, setDraft] = useState(value);
  if (useChangedOnRender([value])) {
    setDraft(value);
  }

  const validateElement = (input: HTMLInputElement, candidate: string): void => {
    if (!candidate) {
      input.setCustomValidity('');
      return;
    }
    if (!VALID_24H_TIME.test(candidate)) {
      input.setCustomValidity('Usa formato 24 h (ej. 22:00).');
      return;
    }
    if (maxTime && VALID_24H_TIME.test(maxTime) && candidate > maxTime) {
      input.setCustomValidity(`La hora no puede superar ${maxTime}.`);
      return;
    }
    input.setCustomValidity('');
  };

  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      maxLength={5}
      max={maxTime}
      pattern="^([01][0-9]|2[0-3]):[0-5][0-9]$"
      placeholder={placeholder}
      value={draft}
      onChange={event => {
        const input = event.currentTarget;
        const raw = event.target.value;
        // Preserve direct programmatic valid HH:mm updates (e.g. tests or paste).
        const next = VALID_24H_TIME.test(raw.trim()) ? raw.trim() : formatLiveDraft(raw, draft);
        setDraft(next);
        if (next === '' || VALID_24H_TIME.test(next)) {
          validateElement(input, next);
          onValueChange(next);
        } else {
          input.setCustomValidity('');
        }
      }}
      onBlur={event => {
        const input = event.currentTarget;
        const normalized = normalizeTime24Input(draft);
        if (normalized !== null) {
          setDraft(normalized);
          validateElement(input, normalized);
          if (normalized !== value) onValueChange(normalized);
        } else {
          validateElement(input, draft);
          input.reportValidity();
        }
        onBlur?.(event);
      }}
    />
  );
};
