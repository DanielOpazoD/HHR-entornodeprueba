// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  createOperationalError,
  normalizeOperationalError,
  OperationalError,
} from '@/services/observability/operationalError';

describe('operationalError', () => {
  it('creates typed operational errors with severity and safe message', () => {
    const error = createOperationalError({
      code: 'test_error',
      message: 'Mensaje interno',
      severity: 'warning',
      userSafeMessage: 'Mensaje visible',
      context: { scope: 'tests' },
    });

    expect(error).toBeInstanceOf(OperationalError);
    expect(error.code).toBe('test_error');
    expect(error.severity).toBe('warning');
    expect(error.userSafeMessage).toBe('Mensaje visible');
    expect(error.context).toEqual({ scope: 'tests' });
  });

  it('normalizes native errors into the shared operational contract', () => {
    const error = normalizeOperationalError(new Error('boom'), {
      code: 'fallback_error',
      message: 'fallback',
      severity: 'error',
      userSafeMessage: 'safe',
    });

    expect(error.code).toBe('fallback_error');
    expect(error.message).toBe('boom');
    expect(error.userSafeMessage).toBe('safe');
  });
});
