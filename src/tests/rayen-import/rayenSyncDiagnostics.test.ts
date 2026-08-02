import { describe, expect, it } from 'vitest';
import { classifyRayenSyncError } from '@/features/rayen-import/observability/rayenSyncDiagnostics';

describe('rayenSyncDiagnostics', () => {
  it.each([
    [
      Object.assign(new Error('El registro fue modificado por otro usuario'), { code: 'aborted' }),
      'concurrency',
    ],
    [Object.assign(new Error('write rejected'), { code: 'aborted' }), 'concurrency'],
    [
      Object.assign(new Error('deadline exceeded'), { code: 'functions/deadline-exceeded' }),
      'timeout',
    ],
    [Object.assign(new Error('endpoint missing'), { code: 'functions/not-found' }), 'unsupported'],
    [
      Object.assign(new Error('Failed to fetch'), { code: 'network-request-failed' }),
      'unavailable',
    ],
    [new Error('El backend devolvió una confirmación inválida'), 'invalid_response'],
    [new Error('sensitive provider payload'), 'unexpected'],
  ])('maps operational errors to a bounded category', (error, expected) => {
    expect(classifyRayenSyncError(error)).toBe(expected);
  });
});
