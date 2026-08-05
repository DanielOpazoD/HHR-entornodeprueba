import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RAYEN_IMPORT_MODE,
  DEFAULT_RAYEN_IMPORT_POLICY,
  normalizeRayenImportPolicy,
} from '@/features/rayen-import';

describe('rayen import policy', () => {
  it('defaults globally to the safe preview policy', () => {
    expect(DEFAULT_RAYEN_IMPORT_MODE).toBe('preview');
    expect(DEFAULT_RAYEN_IMPORT_POLICY).toEqual({
      mode: 'preview',
      clinicalBatchMode: 'off',
      revision: 0,
    });
  });

  it('normalizes the global server policy with independent clinical authority', () => {
    expect(
      normalizeRayenImportPolicy({
        schemaVersion: 2,
        mode: 'auto',
        clinicalBatchMode: 'enforced',
        revision: 4,
        updatedAt: Timestamp.fromDate(new Date(1_000)),
        updatedByUid: 'admin-1',
      })
    ).toEqual({ mode: 'auto', clinicalBatchMode: 'enforced', revision: 4 });
  });

  it('parses a valid v1 policy only as the safe source for an explicit migration', () => {
    expect(
      normalizeRayenImportPolicy({
        schemaVersion: 1,
        mode: 'auto',
        revision: 4,
        updatedAt: Timestamp.fromDate(new Date(1_000)),
        updatedByUid: 'admin-1',
      })
    ).toEqual({ mode: 'auto', clinicalBatchMode: 'off', revision: 4 });
  });

  it('rejects malformed or unversioned automation policies', () => {
    expect(normalizeRayenImportPolicy({ mode: 'auto', revision: 1 })).toBeNull();
    expect(
      normalizeRayenImportPolicy({
        schemaVersion: 2,
        mode: 'auto',
        clinicalBatchMode: 'enforced',
        revision: 1,
        updatedAt: {},
        updatedByUid: 'admin-1',
      })
    ).toBeNull();
    expect(
      normalizeRayenImportPolicy({
        schemaVersion: 2,
        mode: 'automatic',
        clinicalBatchMode: 'enforced',
        revision: 1,
        updatedAt: {},
        updatedByUid: 'admin-1',
      })
    ).toBeNull();
    expect(
      normalizeRayenImportPolicy({
        schemaVersion: 2,
        mode: 'auto',
        clinicalBatchMode: 'enforced',
        revision: 1,
        updatedAt: Timestamp.fromDate(new Date(1_000)),
        updatedByUid: 'admin-1',
        unexpected: true,
      })
    ).toBeNull();
    expect(
      normalizeRayenImportPolicy({
        schemaVersion: 2,
        mode: 'auto',
        clinicalBatchMode: 'enforced',
        revision: 0,
        updatedAt: {},
        updatedByUid: 'admin-1',
      })
    ).toBeNull();
    expect(
      normalizeRayenImportPolicy({
        schemaVersion: 2,
        mode: 'auto',
        clinicalBatchMode: 'fallback',
        revision: 1,
        updatedAt: Timestamp.fromDate(new Date(1_000)),
        updatedByUid: 'admin-1',
      })
    ).toBeNull();
    expect(
      normalizeRayenImportPolicy({
        schemaVersion: 2,
        mode: 'auto',
        clinicalBatchMode: ['enforced'],
        revision: 1,
        updatedAt: Timestamp.fromDate(new Date(1_000)),
        updatedByUid: 'admin-1',
      })
    ).toBeNull();
  });
});
