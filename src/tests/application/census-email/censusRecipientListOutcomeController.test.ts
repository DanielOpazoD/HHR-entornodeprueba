// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildRecipientListServiceFailure,
  buildRecipientListUnknownFailure,
  buildRecipientListValidationFailure,
} from '@/application/census-email/censusRecipientListOutcomeController';

describe('censusRecipientListOutcomeController', () => {
  it('builds validation failures preserving the provided data payload', () => {
    const result = buildRecipientListValidationFailure({ fallbackList: null }, 'Nombre requerido');

    expect(result.status).toBe('failed');
    expect(result.data).toEqual({ fallbackList: null });
    expect(result.issues[0]?.message).toBe('Nombre requerido');
  });

  it('builds service failures preserving user safe messages', () => {
    const result = buildRecipientListServiceFailure(
      { skipped: false },
      {
        issues: [{ kind: 'unknown', message: 'remote failed' }],
        userSafeMessage: 'No se pudo guardar en Firebase.',
      }
    );

    expect(result.status).toBe('failed');
    expect(result.userSafeMessage).toBe('No se pudo guardar en Firebase.');
    expect(result.issues[0]?.message).toBe('remote failed');
  });

  it('builds unknown failures using the native error message when available', () => {
    const result = buildRecipientListUnknownFailure(null, new Error('boom'), 'fallback');

    expect(result.status).toBe('failed');
    expect(result.issues[0]?.message).toBe('boom');
  });
});
