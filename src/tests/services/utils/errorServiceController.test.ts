import { describe, expect, it } from 'vitest';
import { buildErrorLog } from '@/services/utils/errorServiceController';

describe('local cause in the common error log', () => {
  it('keeps only bounded diagnostic strings from a supplied error', () => {
    const log = buildErrorLog({
      message: 'Synthetic operation failed',
      error: {
        name: 'N'.repeat(200),
        message: 'M'.repeat(1500),
        code: 'C'.repeat(200),
        password: 'synthetic-secret',
        callback: () => undefined,
      },
      context: { operation: 'synthetic' },
    });
    expect(log.context).toEqual({
      operation: 'synthetic',
      reason: {
        name: 'N'.repeat(128),
        message: 'M'.repeat(1000),
        code: 'C'.repeat(128),
      },
    });
    expect(() => structuredClone(log)).not.toThrow();
  });

  it('bounds a literal and tolerates diagnostic getters that throw', () => {
    expect(buildErrorLog({ message: 'x', error: 'x'.repeat(1500) }).context?.reason).toBe(
      'x'.repeat(1000)
    );
    expect(
      buildErrorLog({
        message: 'x',
        error: {
          get message() {
            throw new Error('Synthetic getter');
          },
          code: 'synthetic_code',
          name: () => undefined,
        },
      }).context?.reason
    ).toEqual({ code: 'synthetic_code' });
  });
});
