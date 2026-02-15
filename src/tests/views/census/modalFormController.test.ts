import { describe, expect, it, vi } from 'vitest';
import {
  clearModalFieldErrors,
  hasModalFieldErrors,
  submitModalForm,
} from '@/features/census/controllers/modalFormController';

describe('modalFormController', () => {
  it('detects field errors only when values contain messages', () => {
    expect(hasModalFieldErrors({})).toBe(false);
    expect(hasModalFieldErrors({ time: undefined, other: '' })).toBe(false);
    expect(hasModalFieldErrors({ time: 'Hora requerida' })).toBe(true);
  });

  it('clears selected field errors and keeps others', () => {
    const errors = { time: 'invalid', other: 'required', dateTime: undefined };
    const next = clearModalFieldErrors(errors, ['time', 'dateTime']);

    expect(next).toEqual({
      time: undefined,
      other: 'required',
      dateTime: undefined,
    });
    expect(next).not.toBe(errors);
  });

  it('returns original object when selected fields are already clear', () => {
    const errors = { time: undefined, other: 'required' };
    const next = clearModalFieldErrors(errors, ['time']);

    expect(next).toBe(errors);
  });

  it('stops submit when validation fails and reports errors', () => {
    const onConfirm = vi.fn();
    const onValidationErrors = vi.fn();

    const submitted = submitModalForm({
      state: { value: 'bad' },
      validate: () => ({ value: 'invalid' }),
      buildPayload: state => state.value,
      onValidationErrors,
      onConfirm,
    });

    expect(submitted).toBe(false);
    expect(onValidationErrors).toHaveBeenCalledWith({ value: 'invalid' });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('submits payload when validation passes', () => {
    const onConfirm = vi.fn();
    const onValidationErrors = vi.fn();

    const submitted = submitModalForm({
      state: { value: 'ok' },
      validate: () => ({ value: undefined }),
      buildPayload: state => ({ normalized: state.value.toUpperCase() }),
      onValidationErrors,
      onConfirm,
    });

    expect(submitted).toBe(true);
    expect(onValidationErrors).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledWith({ normalized: 'OK' });
  });
});
