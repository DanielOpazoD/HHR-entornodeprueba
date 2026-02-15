import { describe, expect, it, vi } from 'vitest';
import {
  buildSyntheticTextChangeEvent,
  dispatchTextChangeValue,
} from '@/features/census/controllers/textChangeAdapterController';

describe('textChangeAdapterController', () => {
  it('builds synthetic change event with value', () => {
    const event = buildSyntheticTextChangeEvent('abc');
    expect(event.target.value).toBe('abc');
  });

  it('dispatches value through text change callback', () => {
    const fieldHandler = vi.fn();
    const textChange = vi.fn().mockReturnValue(fieldHandler);

    dispatchTextChangeValue(textChange, 'specialty', 'Medicina');

    expect(textChange).toHaveBeenCalledWith('specialty');
    expect(fieldHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ value: 'Medicina' }),
      })
    );
  });
});
