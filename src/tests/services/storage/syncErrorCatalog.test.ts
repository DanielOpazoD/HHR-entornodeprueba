// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { classifySyncError } from '@/services/storage/syncErrorCatalog';

describe('syncErrorCatalog', () => {
  it('classifies permission-denied as authorization and non-retryable', () => {
    const result = classifySyncError({
      code: 'permission-denied',
      message: 'Missing or insufficient permissions',
    });

    expect(result.category).toBe('authorization');
    expect(result.retryable).toBe(false);
    expect(result.severity).toBe('high');
  });

  it('classifies network errors as retryable network category', () => {
    const result = classifySyncError(new Error('Network timeout while writing'));

    expect(result.category).toBe('network');
    expect(result.retryable).toBe(true);
  });

  it('classifies concurrency errors as conflict and non-retryable', () => {
    const conflictError = new Error('Concurrency conflict');
    conflictError.name = 'ConcurrencyError';
    const result = classifySyncError(conflictError);

    expect(result.category).toBe('conflict');
    expect(result.retryable).toBe(false);
  });
});
