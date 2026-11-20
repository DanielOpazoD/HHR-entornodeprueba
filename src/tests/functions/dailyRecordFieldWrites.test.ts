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
type FieldWritesMap = {
  revision: number;
  fenced?: boolean;
  incompleteThrough?: number;
  outsideBedsIncompleteThrough?: number;
  fields: Record<string, { revision: number; digest: string | null }>;
  writes: Record<string, { mutationId: string | null; clientId: string | null }>;
};
const {
  MAX_FIELD_WRITES,
  changedFieldPaths,
  fieldValueDigest: serverDigest,
  isStillWrittenBy,
  nextFieldWrites,
} = require('../../../functions/lib/dailyRecordFieldWrites.js') as {
  MAX_FIELD_WRITES: number;
  changedFieldPaths: (before: unknown, after: unknown) => string[];
  fieldValueDigest: (value: unknown) => string;
  isStillWrittenBy: (day: unknown, paths: string[], mutationId: string | undefined) => boolean;
  nextFieldWrites: (input: {
    previousDay?: unknown;
    paths: string[];
    record: Record<string, unknown>;
    revision: number;
    mutationId?: string | null;
    clientId?: string | null;
    fenced?: boolean;
  }) => FieldWritesMap;
};

const record = (pathology: string, status = 'Estable') => ({
  beds: { R1: { pathology, status, devices: ['CVC'] }, R2: { pathology: 'OTRA' } },
});
type Day = ReturnType<typeof record> & { lastUpdated?: unknown; meta?: Record<string, unknown> };

/** The day a server write of `paths` leaves over `previous`, stamped as the server stamps it. */
const serverWrite = (
  previous: Day | undefined,
  next: ReturnType<typeof record>,
  paths: string[],
  revision: number,
  mutationId: string,
  clientId?: string,
  fenced = false
): Day => {
  const stamp = new AdminTimestamp(1_763_000_000 + revision, 0);
  return {
    ...next,
    lastUpdated: stamp,
    meta: {
      revision,
      updatedAt: stamp,
      lastMutationId: mutationId,
      lastChangedPaths: paths,
      fieldWrites: nextFieldWrites({
        previousDay: previous,
        paths,
        record: next,
        revision,
        mutationId,
        clientId,
        fenced,
      }),
    },
  };
};

const credit = (day: Day) =>
  isLastWrittenBy(storedFieldWrites(day), 'beds.R1.pathology', ['m-P1'], day);

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
  const first = serverWrite(
    undefined,
    record('NEUMONIA'),
    ['beds.R1.pathology'],
    2,
    'm-P1',
    'c-P1'
  );

  it('names the edit, the computer and the stored value of each written field', () => {
    expect(first.meta?.fieldWrites).toEqual({
      revision: 2,
      fields: { 'beds.R1.pathology': { revision: 2, digest: serverDigest('NEUMONIA') } },
      writes: { 2: { mutationId: 'm-P1', clientId: 'c-P1' } },
    });
  });

  it('keeps another field’s entry when the next write is of another field', () => {
    const next = serverWrite(
      first,
      record('NEUMONIA', 'Grave'),
      ['beds.R1.status'],
      3,
      'm-P2',
      'c-P2'
    );
    const map = next.meta?.fieldWrites as FieldWritesMap;
    expect(Object.keys(map.fields).sort()).toEqual(['beds.R1.pathology', 'beds.R1.status']);
    expect(map.writes).toEqual({
      2: { mutationId: 'm-P1', clientId: 'c-P1' },
      3: { mutationId: 'm-P2', clientId: 'c-P2' },
    });
    expect(map.incompleteThrough).toBeUndefined();
  });

  it('replaces the entries a write covers, and a whole-day write replaces them all', () => {
    const bed = serverWrite(first, record('NEUMONIA'), ['beds.R1'], 3, 'm-P2').meta
      ?.fieldWrites as FieldWritesMap;
    expect(Object.keys(bed.fields)).toEqual(['beds.R1']);
    expect(Object.keys(bed.writes)).toEqual(['3']);
    const day = serverWrite(first, record('NEUMONIA'), ['*'], 3, 'm-P2').meta
      ?.fieldWrites as FieldWritesMap;
    expect(day.fields).toEqual({ '*': { revision: 3, digest: null } });
  });

  it('marks a change it may have missed: a write that kept the meta or left the map behind', () => {
    // A direct client write: a new `lastUpdated`, the meta as it was.
    const direct = { ...first, lastUpdated: '2026-11-18T12:00:00.000Z' };
    const afterDirect = serverWrite(
      direct,
      record('NEUMONIA', 'Grave'),
      ['beds.R1.status'],
      3,
      'm-P2'
    ).meta?.fieldWrites as FieldWritesMap;
    expect(afterDirect.incompleteThrough).toBe(2);
    // A server write that left the map at revision 2 (a restore, a CUDYR adjustment).
    const stamp = new AdminTimestamp(1_763_000_100, 0);
    const restored = {
      ...first,
      lastUpdated: stamp,
      meta: { ...first.meta, revision: 3, updatedAt: stamp },
    };
    const afterRestore = serverWrite(
      restored,
      record('NEUMONIA', 'Grave'),
      ['beds.R1.status'],
      4,
      'm-P2'
    ).meta?.fieldWrites as FieldWritesMap;
    expect(afterRestore.incompleteThrough).toBe(3);
    // It stays with the map.
    const restoredDay = serverWrite(
      restored,
      record('NEUMONIA', 'Grave'),
      ['beds.R1.status'],
      4,
      'm-P2'
    );
    const later = serverWrite(
      restoredDay,
      record('NEUMONIA', 'Grave'),
      ['beds.R2.pathology'],
      5,
      'm-P3'
    );
    expect((later.meta?.fieldWrites as FieldWritesMap).incompleteThrough).toBe(3);
  });

  it('limits a direct client write between two fenced writes to the fields outside the beds', () => {
    // Under the Rayen fence the rules keep a client's direct write out of the bed tree.
    const fencedFirst = serverWrite(
      undefined,
      record('NEUMONIA'),
      ['beds.R1.pathology', 'night'],
      2,
      'm-P1',
      'c-P1',
      true
    );
    const direct = { ...fencedFirst, lastUpdated: '2026-11-18T12:00:00.000Z' };
    const fencedNext = serverWrite(
      direct,
      record('NEUMONIA', 'Grave'),
      ['beds.R1.status'],
      3,
      'm-P2',
      'c-P2',
      true
    );
    const map = fencedNext.meta?.fieldWrites as FieldWritesMap;
    expect(map).toMatchObject({ fenced: true, outsideBedsIncompleteThrough: 2 });
    expect(map.incompleteThrough).toBeUndefined();
    const writes = storedFieldWrites(fencedNext);
    expect(isLastWrittenBy(writes, 'beds.R1.pathology', ['m-P1'], fencedNext)).toBe(true);
    expect(isLastWrittenBy(writes, 'night', ['m-P1'], fencedNext)).toBe(false);
    // Without the fence at either write, the direct write may have changed any field.
    for (const [before, now] of [
      [true, false],
      [false, true],
    ]) {
      const unfenced = serverWrite(
        {
          ...serverWrite(
            undefined,
            record('NEUMONIA'),
            ['beds.R1.pathology'],
            2,
            'm-P1',
            'c-P1',
            before
          ),
          lastUpdated: '2026-11-18T12:00:00.000Z',
        },
        record('NEUMONIA', 'Grave'),
        ['beds.R1.status'],
        3,
        'm-P2',
        'c-P2',
        now
      );
      expect((unfenced.meta?.fieldWrites as FieldWritesMap).incompleteThrough).toBe(2);
      expect(credit(unfenced)).toBe(false);
    }
  });

  it(`keeps the newest ${MAX_FIELD_WRITES} fields`, () => {
    let day = first;
    for (let index = 0; index <= MAX_FIELD_WRITES; index++)
      day = serverWrite(
        day,
        record('NEUMONIA'),
        [`beds.B${index}.status`],
        3 + index,
        `m-${index}`
      );
    const map = day.meta?.fieldWrites as FieldWritesMap;
    expect(Object.keys(map.fields)).toHaveLength(MAX_FIELD_WRITES);
    expect(map.fields['beds.R1.pathology']).toBeUndefined();
    expect(Object.keys(map.writes)).toHaveLength(MAX_FIELD_WRITES);
    expect(map.incompleteThrough).toBeUndefined();
  });
});

describe('the fields a whole-day save changes', () => {
  it('names the shortest paths whose values differ, a list as one value', () => {
    const before = { ...record('NEUMONIA'), lastUpdated: 'a', meta: { revision: 1 } };
    const after = {
      ...record('NEUMONIA', 'Grave'),
      lastUpdated: 'b',
      meta: { revision: 2 },
      night: 'NOCHE',
    };
    after.beds.R1.devices = ['CVC', 'SNG'];
    expect(changedFieldPaths(before, after).sort()).toEqual([
      'beds.R1.devices',
      'beds.R1.status',
      'night',
    ]);
    expect(changedFieldPaths(before, structuredClone(before))).toEqual([]);
  });

  it('reads a stored timestamp and the same instant alike', () => {
    expect(
      changedFieldPaths(
        { at: new AdminTimestamp(1_763_000_000, 0) },
        { at: new Date(1_763_000_000_000) }
      )
    ).toEqual([]);
  });
});

describe('the replay’s reading of the map', () => {
  /** P1's diagnosis (revision 2), then P2's status (revision 3). */
  const stored = () =>
    serverWrite(
      serverWrite(undefined, record('NEUMONIA'), ['beds.R1.pathology'], 2, 'm-P1', 'c-P1'),
      record('NEUMONIA', 'Grave'),
      ['beds.R1.status'],
      3,
      'm-P2',
      'c-P2'
    );
  const credited = (day: Day, path = 'beds.R1.pathology', ids = ['m-P1']) =>
    isLastWrittenBy(storedFieldWrites(day), path, ids, day);

  it('credits a field to its own earlier edit after another computer wrote another field', () => {
    const day = stored();
    expect(credited(day)).toBe(true);
    expect(credited(day, 'beds.R1.status')).toBe(false);
    expect(credited(day, 'beds.R1.pathology', ['m-other'])).toBe(false);
  });

  it('does not credit a field whose value no longer matches its digest', () => {
    const day = stored();
    day.beds.R1.pathology = 'OTRO';
    expect(credited(day)).toBe(false);
  });

  it('does not credit a field after a write the map may have missed, even with the same text', () => {
    // A direct client write puts another text and the first one back; then a server write.
    const direct = { ...stored(), lastUpdated: '2026-11-18T12:00:00.000Z' };
    expect(credited(direct)).toBe(false);
    const next = serverWrite(direct, record('NEUMONIA', 'Estable'), ['beds.R1.status'], 4, 'm-P3');
    expect(credited(next)).toBe(false);
    // A later edit of P1 is credible again.
    const own = serverWrite(
      next,
      record('NEUMONIA 2', 'Estable'),
      ['beds.R1.pathology'],
      5,
      'm-P1b'
    );
    expect(credited(own, 'beds.R1.pathology', ['m-P1b'])).toBe(true);
  });

  it('does not take an identifier a non-recording write inherited as its own', () => {
    // A CUDYR adjustment keeps `lastMutationId` and names its own field.
    const before = stored();
    const stamp = new AdminTimestamp(1_763_000_500, 0);
    const adjusted = {
      ...before,
      lastUpdated: stamp,
      meta: { ...before.meta, revision: 4, updatedAt: stamp, lastChangedPaths: ['beds.R1.status'] },
    };
    expect(credited(adjusted, 'beds.R1.status', ['m-P2'])).toBe(false);
  });

  it('tells another computer’s write after the revision a field was read at', () => {
    const writes = storedFieldWrites(stored());
    const elsewhere = (path: string, seen: number, ids: string[] = [], client?: string) =>
      isWrittenElsewhereSince(writes, path, seen, ids, client);
    expect(elsewhere('beds.R1.status', 1)).toBe(true);
    expect(elsewhere('beds.R1.status', 3)).toBe(false);
    expect(elsewhere('beds.R1.status', 1, ['m-P2'])).toBe(false);
    expect(elsewhere('beds.R1.status', 1, [], 'c-P2')).toBe(false);
    expect(elsewhere('beds.R1', 1)).toBe(true);
    expect(elsewhere('beds.R1.status.detail', 1)).toBe(false);
  });

  it('reads a day saved before the map by its last write, as before', () => {
    const stamp = new ClientTimestamp(1_763_000_000, 0);
    const day = {
      ...record('NEUMONIA'),
      lastUpdated: stamp,
      meta: {
        revision: 2,
        updatedAt: stamp,
        lastMutationId: 'm-P1',
        lastChangedPaths: ['beds.R1.pathology'],
      },
    };
    expect(storedFieldWrites(day)).toEqual([
      {
        path: 'beds.R1.pathology',
        revision: 2,
        mutationId: 'm-P1',
        clientId: undefined,
        digest: clientDigest('NEUMONIA'),
        credible: true,
      },
    ]);
    expect(credited(day)).toBe(true);
    expect(credited({ ...day, lastUpdated: '2026-11-18T12:00:00.000Z' })).toBe(false);
  });
});

describe('the server’s reading of the map (a replay of an edit already stored)', () => {
  const first = serverWrite(
    undefined,
    record('NEUMONIA'),
    ['beds.R1.pathology'],
    2,
    'm-P1',
    'c-P1'
  );
  const otherBed = serverWrite(
    first,
    { ...record('NEUMONIA'), beds: { ...record('NEUMONIA').beds, R2: { pathology: 'ITU' } } },
    ['beds.R2.pathology'],
    3,
    'm-P2',
    'c-P2'
  );
  const sameField = serverWrite(first, record('NEUMONIA GRAVE'), ['beds.R1.pathology'], 3, 'm-P2');
  const wholeBed = serverWrite(first, record('NEUMONIA'), ['beds.R1'], 3, 'm-P2');
  const below = serverWrite(first, record('NEUMONIA'), ['beds.R1.pathology.detail'], 3, 'm-P2');
  const direct = { ...otherBed, lastUpdated: '2026-11-18T12:00:00.000Z' };
  const afterDirect = serverWrite(direct, record('NEUMONIA'), ['beds.R2.status'], 4, 'm-P3');
  const changed = {
    ...otherBed,
    beds: { ...otherBed.beds, R1: { ...otherBed.beds.R1, pathology: 'OTRO' } },
  };
  const stamp = new AdminTimestamp(1_763_000_100, 0);
  const mapBehind = {
    ...otherBed,
    lastUpdated: stamp,
    meta: { ...otherBed.meta, revision: 4, updatedAt: stamp },
  };
  const bedAndField = serverWrite(
    undefined,
    record('NEUMONIA'),
    ['beds.R1', 'beds.R1.pathology'],
    2,
    'm-P1'
  );
  // Under the Rayen fence a direct client write between two server writes stays outside the beds.
  const fenced = serverWrite(
    undefined,
    Object.assign(record('NEUMONIA'), { night: 'NOCHE' }),
    ['beds.R1.pathology', 'night'],
    2,
    'm-P1',
    'c-P1',
    true
  );
  const fencedAfterDirect = serverWrite(
    { ...fenced, lastUpdated: '2026-11-18T12:00:00.000Z' },
    Object.assign(record('NEUMONIA', 'Grave'), { night: 'NOCHE' }),
    ['beds.R1.status'],
    3,
    'm-P2',
    'c-P2',
    true
  );
  const days: Array<[string, Day]> = [
    ['its value changed without the map', changed],
    ['a server write that left the map behind', mapBehind],
    ['a write of the bed and its field together', bedAndField],
    ['a direct client write between two fenced writes', fencedAfterDirect],
    ['only its own write', first],
    ['another bed written after it', otherBed],
    ['the same field written after it', sameField],
    ['its bed written whole after it', wholeBed],
    ['a field below it written after it', below],
    ['a direct client write after it', direct],
    ['a server write after a direct client write', afterDirect],
  ];

  it.each(days)('agrees with the replay for %s', (_label, day) => {
    for (const path of ['beds.R1.pathology', 'beds.R1.status', 'beds.R2.pathology', 'night'])
      for (const id of ['m-P1', 'm-P2'])
        expect(isStillWrittenBy(day, [path], id)).toBe(
          isLastWrittenBy(storedFieldWrites(day), path, [id], day)
        );
  });

  it('credits every path of the request or none', () => {
    expect(isStillWrittenBy(otherBed, ['beds.R1.pathology'], 'm-P1')).toBe(true);
    expect(isStillWrittenBy(otherBed, ['beds.R1.pathology', 'beds.R1.status'], 'm-P1')).toBe(false);
    expect(isStillWrittenBy(otherBed, [], 'm-P1')).toBe(false);
    expect(isStillWrittenBy(otherBed, ['*'], 'm-P1')).toBe(false);
    expect(isStillWrittenBy(otherBed, ['beds.R1.pathology'], undefined)).toBe(false);
  });

  it('never credits, and never throws, on a malformed map', () => {
    const odd: unknown[] = [null, undefined, 'x', 7, [], [1], { revision: '3' }, true];
    const map = otherBed.meta?.fieldWrites as FieldWritesMap;
    const variants: unknown[] = [
      undefined,
      null,
      { meta: null },
      { meta: [] },
      ...odd.map(fieldWrites => ({ ...otherBed, meta: { ...otherBed.meta, fieldWrites } })),
      ...odd.map(revision => ({ ...otherBed, meta: { ...otherBed.meta, revision } })),
      ...odd.map(fields => ({
        ...otherBed,
        meta: { ...otherBed.meta, fieldWrites: { ...map, fields } },
      })),
      ...odd.map(writes => ({
        ...otherBed,
        meta: { ...otherBed.meta, fieldWrites: { ...map, writes } },
      })),
      ...odd.map(entry => ({
        ...otherBed,
        meta: {
          ...otherBed.meta,
          fieldWrites: {
            ...map,
            fields: { 'beds.R1.pathology': entry },
          },
        },
      })),
      ...odd.map(lastUpdated => ({ ...otherBed, lastUpdated })),
    ];
    for (const day of variants)
      expect(isStillWrittenBy(day, ['beds.R1.pathology'], 'm-P1')).toBe(false);
  });
});
