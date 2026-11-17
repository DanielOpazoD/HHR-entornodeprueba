// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildTransferOperationError,
  resolveTransferOperationErrorKind,
} from '@/services/transfers/transferErrorPolicy';

describe('transferErrorPolicy', () => {
  it.each([
    [{ code: 'permission-denied' }, 'permission_denied'],
    [{ code: 'storage/unauthorized' }, 'permission_denied'],
    [{ message: 'Missing or insufficient permissions.' }, 'permission_denied'],
    [{ message: 'Transfer not found' }, 'not_found'],
    [{ message: 'Cannot delete a transferred request' }, 'conflict'],
    [{ message: 'Version conflict' }, 'conflict'],
    [{ code: 'unavailable', message: 'offline' }, 'unknown'],
    [new Error('boom'), 'unknown'],
    [null, 'unknown'],
    [undefined, 'unknown'],
    ['plain text', 'unknown'],
  ])('classifies %j as %s', (error, kind) => {
    expect(resolveTransferOperationErrorKind(error)).toBe(kind);
  });

  it.each([
    ['permission_denied', 'No tienes permisos para completar esta acción de traslado.'],
    ['not_found', 'La solicitud de traslado ya no existe o fue movida.'],
    ['conflict', 'La acción no se puede completar por el estado actual del traslado.'],
    ['unknown', 'No se pudo guardar el traslado.'],
  ] as const)('gives the person a safe message for %s', (kind, message) => {
    const error = buildTransferOperationError(kind, 'No se pudo guardar el traslado.');

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(kind);
    expect(error.message).toBe(message);
    expect(error.userSafeMessage).toBe(message);
  });
});
