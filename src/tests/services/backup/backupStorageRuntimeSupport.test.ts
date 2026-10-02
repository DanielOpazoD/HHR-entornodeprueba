// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  createBackupMutationResultFromError,
  resolveDeleteMutationStatus,
} from '@/services/backup/backupStorageRuntimeSupport';

describe('backupStorageRuntimeSupport', () => {
  it('maps invalid-date and storage categories to stable mutation results', () => {
    expect(
      createBackupMutationResultFromError(new Error('invalid date'), { invalidDate: true })
    ).toEqual({
      status: 'invalid_date',
      error: expect.any(Error),
      data: null,
    });

    expect(createBackupMutationResultFromError({ code: 'storage/unauthorized' })).toMatchObject({
      status: 'permission_denied',
      data: null,
    });

    expect(createBackupMutationResultFromError({ code: 'storage/object-not-found' })).toMatchObject(
      {
        status: 'not_found',
        data: null,
      }
    );
  });

  it('resolves delete status without leaking branching to consumers', () => {
    expect(resolveDeleteMutationStatus({ code: 'storage/unauthorized' })).toBe('permission_denied');
    expect(resolveDeleteMutationStatus({ code: 'storage/object-not-found' })).toBe('not_found');
  });
});
