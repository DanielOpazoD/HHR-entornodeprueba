import { describe, expect, it } from 'vitest';
import { classifyRayenSyncError } from '@/features/rayen-import/observability/rayenSyncDiagnostics';

describe('rayenSyncDiagnostics', () => {
  it.each([
    {
      label: 'concurrent modification',
      error: Object.assign(new Error('El registro fue modificado por otro usuario'), {
        code: 'aborted',
      }),
      expected: 'concurrency',
    },
    {
      label: 'aborted write',
      error: Object.assign(new Error('write rejected'), { code: 'aborted' }),
      expected: 'concurrency',
    },
    {
      label: 'deadline',
      error: Object.assign(new Error('deadline exceeded'), {
        code: 'functions/deadline-exceeded',
      }),
      expected: 'timeout',
    },
    {
      label: 'missing endpoint',
      error: Object.assign(new Error('endpoint missing'), { code: 'functions/not-found' }),
      expected: 'unsupported',
    },
    {
      label: 'network failure',
      error: Object.assign(new Error('Failed to fetch'), { code: 'network-request-failed' }),
      expected: 'unavailable',
    },
    {
      label: 'invalid confirmation',
      error: new Error('El backend devolvió una confirmación inválida'),
      expected: 'invalid_response',
    },
    {
      label: 'unclassified provider failure',
      error: new Error('sensitive provider payload'),
      expected: 'unexpected',
    },
  ])('$label maps to $expected', ({ error, expected }) => {
    expect(classifyRayenSyncError(error)).toBe(expected);
  });
});
