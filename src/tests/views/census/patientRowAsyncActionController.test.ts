import { describe, expect, it, vi } from 'vitest';
import { runPatientRowAsyncActionSafely } from '@/features/census/controllers/patientRowAsyncActionController';

describe('patientRowAsyncActionController', () => {
  it('executes sync actions safely', () => {
    const action = vi.fn();
    runPatientRowAsyncActionSafely(action);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('swallows rejected async actions', async () => {
    const action = vi.fn().mockRejectedValue(new Error('boom'));
    expect(() => runPatientRowAsyncActionSafely(action)).not.toThrow();
    await Promise.resolve();
    expect(action).toHaveBeenCalledTimes(1);
  });
});
