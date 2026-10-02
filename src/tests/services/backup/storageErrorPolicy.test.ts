// @vitest-environment node

import {
  classifyStorageError,
  isExpectedStorageLookupMiss,
  shouldLogStorageError,
  toStorageOperationalError,
} from '@/services/backup/storageErrorPolicy';
import { describe, expect, it } from 'vitest';

describe('storageErrorPolicy', () => {
  it('classifies 404 not found errors', () => {
    const error = { code: 'storage/object-not-found', status: 404 };

    expect(classifyStorageError(error)).toBe('not_found');
    expect(isExpectedStorageLookupMiss(error)).toBe(true);
    expect(shouldLogStorageError(error)).toBe(false);
  });

  it('classifies permission denied errors by message', () => {
    const error = { message: 'FirebaseError: Missing or insufficient permissions.' };

    expect(classifyStorageError(error)).toBe('permission_denied');
    expect(isExpectedStorageLookupMiss(error)).toBe(true);
  });

  it('classifies timeout errors', () => {
    const error = { message: 'Request timed out while contacting storage backend' };

    expect(classifyStorageError(error)).toBe('timeout');
    expect(shouldLogStorageError(error)).toBe(false);
  });

  it('keeps unknown errors actionable', () => {
    const error = { message: 'Unexpected failure in storage pipeline' };

    expect(classifyStorageError(error)).toBe('unknown');
    expect(isExpectedStorageLookupMiss(error)).toBe(false);
    expect(shouldLogStorageError(error)).toBe(true);
  });

  it('maps storage errors into the shared operational error contract', () => {
    const operationalError = toStorageOperationalError(
      { message: 'FirebaseError: Missing or insufficient permissions.' },
      { context: { storageRoot: 'backups' } }
    );

    expect(operationalError.code).toBe('storage_permission_denied');
    expect(operationalError.severity).toBe('warning');
    expect(operationalError.userSafeMessage).toBe('No fue posible acceder al archivo solicitado.');
    expect(operationalError.context).toEqual({
      storageCategory: 'permission_denied',
      lookupStatus: 'restricted',
      storageRoot: 'backups',
    });
  });
});
