import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore');

  class MockTimestamp {
    private readonly value: string;

    constructor(value = '2026-02-20T12:00:00.000Z') {
      this.value = value;
    }

    static now = vi.fn(() => new MockTimestamp());

    toDate() {
      return new Date(this.value);
    }
  }

  return {
    ...actual,
    collection: vi.fn(() => 'records-collection'),
    doc: vi.fn((_collectionRef: unknown, date: string) => ({ date })),
    Timestamp: MockTimestamp,
  };
});

vi.mock('@/services/firebase-runtime/firebaseConfig', () => ({
  db: {},
}));

vi.mock('@/services/repositories/dataMigration', () => ({
  migrateLegacyData: vi.fn((record: Record<string, unknown>, docId: string) => ({
    date: docId,
    ...record,
  })),
}));

vi.mock('@/services/staff/dailyRecordStaffing', () => ({
  normalizeUnknownDailyRecordStaffing: vi.fn(
    (
      rawData: Record<string, unknown>,
      ensureArray: (value: unknown, length: number) => string[]
    ) => ({
      nurses: ensureArray(rawData.nurses, 2),
      nursesDayShift: ensureArray(rawData.nursesDayShift, 2),
      nursesNightShift: ensureArray(rawData.nursesNightShift, 2),
    })
  ),
}));

import { Timestamp, doc } from 'firebase/firestore';
import {
  docToRecord,
  ensureArray,
  flattenObject,
  getRecordDocRef,
  readStringCatalogFromSnapshot,
  sanitizeForFirestore,
} from '@/services/storage/firestore/firestoreShared';

describe('firestoreShared', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds record document refs from the date key', () => {
    expect(getRecordDocRef('2026-03-14')).toEqual({ date: '2026-03-14' });
    expect(doc).toHaveBeenCalled();
  });

  it('sanitizes undefined values recursively for Firestore payloads', () => {
    expect(
      sanitizeForFirestore({
        top: undefined,
        nested: {
          value: undefined,
          arr: [1, undefined, { child: undefined }],
        },
      })
    ).toEqual({
      top: null,
      nested: {
        value: null,
        arr: [1, null, { child: null }],
      },
    });
  });

  it('normalizes arrays, keyed objects and empty values', () => {
    expect(ensureArray(['A'], 2)).toEqual(['A', '']);
    expect(ensureArray({ 0: 'A', 1: 'B' }, 3)).toEqual(['A', 'B', '']);
    expect(ensureArray(null, 2)).toEqual(['', '']);
  });

  it('flattens nested objects while preserving dates and timestamps', () => {
    const timestamp = Timestamp.now();
    const result = flattenObject({
      bed: {
        patient: 'Paciente',
        metadata: {
          lastUpdated: timestamp,
        },
      },
      empty: {},
      when: new Date('2026-03-14T00:00:00.000Z'),
    });

    expect(result).toEqual({
      'bed.patient': 'Paciente',
      'bed.metadata.lastUpdated': timestamp,
      empty: {},
      when: new Date('2026-03-14T00:00:00.000Z'),
    });
  });

  it('converts firestore docs into normalized daily records', () => {
    const record = docToRecord(
      {
        beds: {},
        nursesDayShift: { 0: 'Nurse Day 1' },
        nursesNightShift: ['Nurse Night 1'],
        tensDayShift: undefined,
        tensNightShift: { 0: 'TENS Night 1' },
        activeExtraBeds: undefined,
        lastUpdated: Timestamp.now(),
      },
      '2026-03-14'
    );

    expect(record.date).toBe('2026-03-14');
    expect(record.lastUpdated).toBe('2026-02-20T12:00:00.000Z');
    expect(record.nursesDayShift).toEqual(['Nurse Day 1', '']);
    expect(record.nursesNightShift).toEqual(['Nurse Night 1', '']);
    expect(record.tensDayShift).toEqual(['', '', '']);
    expect(record.tensNightShift).toEqual(['TENS Night 1', '', '']);
    expect(record.activeExtraBeds).toEqual([]);
  });

  it('reads catalog lists from primary, legacy and missing shapes', () => {
    expect(
      readStringCatalogFromSnapshot({ exists: () => true, data: () => ({ list: ['A'] }) }, 'nurses')
    ).toEqual(['A']);

    expect(
      readStringCatalogFromSnapshot(
        { exists: () => true, data: () => ({ nurses: ['Legacy'] }) },
        'nurses'
      )
    ).toEqual(['Legacy']);

    expect(
      readStringCatalogFromSnapshot({ exists: () => false, data: () => undefined }, 'nurses')
    ).toEqual([]);
  });
});
