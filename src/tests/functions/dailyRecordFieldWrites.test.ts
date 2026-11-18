// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Timestamp as AdminTimestamp } from 'firebase-admin/firestore';
import { Timestamp as ClientTimestamp } from 'firebase/firestore';
import {
  fieldValueDigest as clientDigest,
  isLastWrittenBy,
  isWrittenElsewhereSince,
  storedFieldWrites,
} from '@/services/storage/sync/fieldWriteAttribution';

// The server writes `meta.fieldWrites` (functions/lib/dailyRecordFieldWrites.js) and the replay
// reads it (fieldWriteAttribution.ts): both digest a stored value the same way, or no field is
// ever credited to its own edit.
const require = createRequire(import.meta.url);
const {
  MAX_FIELD_WRITES,
  fieldValueDigest: serverDigest,
  nextFieldWrites,
} = require('../../../functions/lib/dailyRecordFieldWrites.js') as {
  MAX_FIELD_WRITES: number;
  fieldValueDigest: (value: unknown) => string;
  nextFieldWrites: (input: {
    previous?: unknown;
    paths: string[];
    record: Record<string, unknown>;
    revision: number;
    mutationId?: string | null;
    clientId?: string | null;
  }) => {
    fields: Record<string, { revision: number; digest: string | null }>;
    writes: Record<string, { mutationId: string | null; clientId: string | null }>;
  };
};

const record = (pathology: string, status = 'Estable') => ({
  beds: { R1: { pathology, status, devices: ['CVC'] }, R2: { pathology: 'OTRA' } },
});

describe('the field-write digest', () => {
  it.each([
    ['text', 'NEUMONIA POR ASPIRACION'],
    ['accents and ñ', 'Peña, Ñandú — insuficiencia'],
    ['number', 17],
    ['boolean', true],
    ['absent', undefined],
    ['null', null],
    ['list', ['CVC', { since: '2026-11-18', site: 'yugular' }]],
    ['map with null and nested keys', { b: 1, a: { d: null, c: [1, 2] } }],
  ])('is the same on the server and on the client for a %s', (_label, value) => {
    expect(clientDigest(value)).toBe(serverDigest(value));
  });

  it('reads a map by its keys, not their order, and an absent value as null', () => {
    expect(serverDigest({ a: 1, b: 2 })).toBe(serverDigest({ b: 2, a: 1 }));
    expect(serverDigest({ a: 1, gone: undefined })).toBe(serverDigest({ a: 1 }));
    expect(serverDigest(undefined)).toBe(serverDigest(null));
    expect(serverDigest('A')).not.toBe(serverDigest('B'));
    expect(serverDigest(['A', 'B'])).not.toBe(serverDigest(['B', 'A']));
  });

  it('reads the admin and the browser timestamp of one instant alike', () => {
    expect(clientDigest(new ClientTimestamp(1_763_000_000, 123_000))).toBe(
      serverDigest(new AdminTimestamp(1_763_000_000, 123_000))
    );
    expect(serverDigest(new Date(1_763_000_000_123))).toBe(
      serverDigest(new AdminTimestamp(1_763_000_000, 123_000_000))
    );
  });
});

describe('the map a write leaves', () => {
  const first = nextFieldWrites({
    paths: ['beds.R1.pathology'],
    record: record('NEUMONIA'),
    revision: 2,
    mutationId: 'm-P1',
    clientId: 'client-P1',
  });

  it('names the edit, the computer and the stored value of each written field', () => {
    expect(first).toEqual({
      fields: { 'beds.R1.pathology': { revision: 2, digest: serverDigest('NEUMONIA') } },
      writes: { 2: { mutationId: 'm-P1', clientId: 'client-P1' } },
    });
  });

  it('keeps another field’s entry when the next write is of another field', () => {
    const next = nextFieldWrites({
      previous: first,
      paths: ['beds.R1.status'],
      record: record('NEUMONIA', 'Grave'),
      revision: 3,
      mutationId: 'm-P2',
      clientId: 'client-P2',
    });
    expect(Object.keys(next.fields).sort()).toEqual(['beds.R1.pathology', 'beds.R1.status']);
    expect(next.writes).toEqual({
      2: { mutationId: 'm-P1', clientId: 'client-P1' },
      3: { mutationId: 'm-P2', clientId: 'client-P2' },
    });
  });

  it('replaces the entries a write covers, and a whole-day write replaces them all', () => {
    const bed = nextFieldWrites({
      previous: first,
      paths: ['beds.R1'],
      record: record('NEUMONIA'),
      revision: 3,
      mutationId: 'm-P2',
    });
    expect(Object.keys(bed.fields)).toEqual(['beds.R1']);
    expect(Object.keys(bed.writes)).toEqual(['3']);
    const day = nextFieldWrites({ previous: first, paths: [], record: {}, revision: 3 });
    expect(day.fields).toEqual({ '*': { revision: 3, digest: null } });
  });

  it(`keeps the newest ${MAX_FIELD_WRITES} fields`, () => {
    let map = first;
    for (let index = 0; index <= MAX_FIELD_WRITES; index++)
      map = nextFieldWrites({
        previous: map,
        paths: [`beds.B${index}.status`],
        record: {},
        revision: 3 + index,
        mutationId: `m-${index}`,
      });
    expect(Object.keys(map.fields)).toHaveLength(MAX_FIELD_WRITES);
    expect(map.fields['beds.R1.pathology']).toBeUndefined();
    expect(Object.keys(map.writes)).toHaveLength(MAX_FIELD_WRITES);
  });
});

describe('the replay’s reading of the map', () => {
  /** The stored day after P1's diagnosis (revision 2) and P2's status (revision 3). */
  const stored = () => {
    const day = record('NEUMONIA', 'Grave');
    const first = nextFieldWrites({
      paths: ['beds.R1.pathology'],
      record: day,
      revision: 2,
      mutationId: 'm-P1',
      clientId: 'client-P1',
    });
    const fieldWrites = nextFieldWrites({
      previous: first,
      paths: ['beds.R1.status'],
      record: day,
      revision: 3,
      mutationId: 'm-P2',
      clientId: 'client-P2',
    });
    return {
      ...day,
      meta: {
        revision: 3,
        lastMutationId: 'm-P2',
        lastChangedPaths: ['beds.R1.status'],
        fieldWrites,
      },
    };
  };

  it('credits a field to its own earlier edit after another computer wrote another field', () => {
    const day = stored();
    const writes = storedFieldWrites(day);
    expect(isLastWrittenBy(writes, 'beds.R1.pathology', ['m-P1'], day)).toBe(true);
    expect(isLastWrittenBy(writes, 'beds.R1.status', ['m-P1'], day)).toBe(false);
    expect(isLastWrittenBy(writes, 'beds.R1.pathology', ['m-other'], day)).toBe(false);
  });

  it('does not credit a field whose value changed without the map', () => {
    const day = stored();
    day.beds.R1.pathology = 'OTRO';
    expect(isLastWrittenBy(storedFieldWrites(day), 'beds.R1.pathology', ['m-P1'], day)).toBe(false);
  });

  it('tells another computer’s write after the revision a field was read at', () => {
    const writes = storedFieldWrites(stored());
    const elsewhere = (path: string, seen: number, ids: string[] = [], client?: string) =>
      isWrittenElsewhereSince(writes, path, seen, ids, client);
    expect(elsewhere('beds.R1.status', 1)).toBe(true);
    expect(elsewhere('beds.R1.status', 3)).toBe(false);
    expect(elsewhere('beds.R1.status', 1, ['m-P2'])).toBe(false);
    expect(elsewhere('beds.R1.status', 1, [], 'client-P2')).toBe(false);
    expect(elsewhere('beds.R1', 1)).toBe(true);
    expect(elsewhere('beds.R1.status.detail', 1)).toBe(false);
  });

  it('reads a day saved before the map by its last write, as before', () => {
    const day = {
      ...record('NEUMONIA'),
      meta: { revision: 2, lastMutationId: 'm-P1', lastChangedPaths: ['beds.R1.pathology'] },
    };
    const writes = storedFieldWrites(day);
    expect(writes).toEqual([
      {
        path: 'beds.R1.pathology',
        revision: 2,
        mutationId: 'm-P1',
        clientId: undefined,
        digest: clientDigest('NEUMONIA'),
      },
    ]);
    expect(isLastWrittenBy(writes, 'beds.R1.pathology', ['m-P1'], day)).toBe(true);
  });
});
