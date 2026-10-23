import { describe, expect, it, vi } from 'vitest';

// The projection must match the real SDK classes, not the global test double.
vi.mock('firebase/firestore', async () => await vi.importActual('firebase/firestore'));

import {
  arrayRemove,
  arrayUnion,
  deleteField,
  GeoPoint,
  increment,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import {
  projectFirestoreUpdate,
  UnsupportedFirestoreUpdateProjectionError,
} from '@/services/storage/firestore/firestoreUpdateProjection';

// Synthetic census fragments only; shapes follow what prepareFirestorePartialData emits.
const committedAt = Timestamp.fromMillis(Date.parse('2026-10-23T12:00:00.000Z'));

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !(value instanceof Timestamp)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

describe('projectFirestoreUpdate', () => {
  it('replaces a top-level leaf and keeps every untouched field', () => {
    const base = { date: '2026-10-23', lastUpdated: 'old', handoffNovedadesDayShift: 'antes' };

    expect(
      projectFirestoreUpdate(base, {
        handoffNovedadesDayShift: 'después',
        lastUpdated: committedAt,
      })
    ).toEqual({
      date: '2026-10-23',
      lastUpdated: committedAt,
      handoffNovedadesDayShift: 'después',
    });
  });

  it('replaces a nested object leaf wholesale, like a UPC checklist with fewer keys', () => {
    const base = {
      beds: {
        R1: { patientName: 'Paciente Sintético', upcChecklist: { a: true, b: true, c: true } },
      },
      bedTypeOverrides: { R2: 'UCI' },
    };

    expect(
      projectFirestoreUpdate(base, {
        'beds.R1.isUPC': true,
        'beds.R1.upcChecklist': { a: false },
        'bedTypeOverrides.R1': 'UTI',
      })
    ).toEqual({
      beds: { R1: { patientName: 'Paciente Sintético', isUPC: true, upcChecklist: { a: false } } },
      bedTypeOverrides: { R1: 'UTI', R2: 'UCI' },
    });
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['a string', 'sin cuna'],
    ['an array', ['x']],
    ['a Timestamp', Timestamp.fromMillis(0)],
  ])('replaces %s intermediate with a map (crib creation)', (_label, clinicalCrib) => {
    const bed: Record<string, unknown> = { patientName: 'Madre Sintética' };
    if (clinicalCrib !== undefined) bed.clinicalCrib = clinicalCrib;

    expect(
      projectFirestoreUpdate(
        { beds: { R1: bed } },
        {
          'beds.R1.clinicalCrib.patientName': 'RN Sintético',
          'beds.R1.clinicalCrib.clinicalEpisodeId': 'crib-episode',
        }
      )
    ).toEqual({
      beds: {
        R1: {
          patientName: 'Madre Sintética',
          clinicalCrib: { patientName: 'RN Sintético', clinicalEpisodeId: 'crib-episode' },
        },
      },
    });
  });

  it('creates every missing intermediate map down to the leaf', () => {
    expect(projectFirestoreUpdate({}, { 'beds.R9.clinicalCrib.bedMode': 'Cuna' })).toEqual({
      beds: { R9: { clinicalCrib: { bedMode: 'Cuna' } } },
    });
  });

  it('stores an empty-map leaf as an empty map, replacing the previous content', () => {
    const base = { beds: { R1: { deviceDetails: { CVC: { installationDate: '2026-10-01' } } } } };

    expect(
      projectFirestoreUpdate(base, { 'beds.R1.deviceDetails': {}, 'beds.R2.deviceDetails': {} })
    ).toEqual({ beds: { R1: { deviceDetails: {} }, R2: { deviceDetails: {} } } });
  });

  it('replaces an array leaf wholesale and never walks into it (reclassification)', () => {
    const base = { discharges: [{ id: 'mov-a' }, { id: 'mov-c' }], cma: [] };

    expect(
      projectFirestoreUpdate(base, { discharges: [{ id: 'mov-c' }], cma: [{ id: 'mov-a' }] })
    ).toEqual({ discharges: [{ id: 'mov-c' }], cma: [{ id: 'mov-a' }] });
    expect(projectFirestoreUpdate(base, { 'discharges.0': 'x' }).discharges).toEqual({ 0: 'x' });
  });

  it('merges a flattened rayenSync into the stored map, keeping legacy sibling keys', () => {
    const base = {
      rayenSync: { at: 'old-at', by: 'old-by', runId: 'run-old', legacyImportedAt: 'legacy' },
      rayenSyncHistory: [{ id: 'run-old', status: 'completed' }],
    };

    expect(
      projectFirestoreUpdate(base, {
        'rayenSync.at': 'new-at',
        'rayenSync.runId': 'run-new',
        rayenSyncHistory: [{ id: 'run-new', status: 'completed' }],
      })
    ).toEqual({
      rayenSync: { at: 'new-at', by: 'old-by', runId: 'run-new', legacyImportedAt: 'legacy' },
      rayenSyncHistory: [{ id: 'run-new', status: 'completed' }],
    });
  });

  it('stores Dates as Timestamps and keeps Timestamps as they are', () => {
    const date = new Date('2026-10-23T08:30:00.000Z');
    const projected = projectFirestoreUpdate(
      {},
      { lastUpdated: committedAt, 'beds.R1.photo': { takenAt: date }, events: [date] }
    );

    expect(projected.lastUpdated).toBe(committedAt);
    expect(projected.beds.R1.photo.takenAt).toEqual(Timestamp.fromDate(date));
    expect(projected.beds.R1.photo.takenAt).toBeInstanceOf(Timestamp);
    expect(projected.events).toEqual([Timestamp.fromDate(date)]);
  });

  it('truncates Timestamps to the microseconds Firestore keeps', () => {
    const projected = projectFirestoreUpdate(
      {},
      {
        'beds.R1.takenAt': new Timestamp(1_700_000_000, 123_456_789),
        events: [new Timestamp(1_700_000_000, 999)],
      }
    );

    expect(projected.beds.R1.takenAt).toEqual(new Timestamp(1_700_000_000, 123_456_000));
    expect(projected.events).toEqual([new Timestamp(1_700_000_000, 0)]);
  });

  it('skips top-level undefined, drops it inside maps and stores null for it or a hole in arrays', () => {
    const base = { handoffNovedadesDayShift: 'se mantiene', beds: { R1: { pathology: 'Dx' } } };

    expect(
      projectFirestoreUpdate(base, {
        handoffNovedadesDayShift: undefined,
        'beds.R1.pathology': undefined,
        'beds.R1.vitalSigns': { heartRate: 80, temperature: undefined },
        // eslint-disable-next-line no-sparse-arrays
        'beds.R1.devices': ['VVP', undefined, , 'CVC'],
      })
    ).toEqual({
      handoffNovedadesDayShift: 'se mantiene',
      beds: {
        R1: { pathology: 'Dx', vitalSigns: { heartRate: 80 }, devices: ['VVP', null, null, 'CVC'] },
      },
    });
  });

  it('applies overlapping paths in payload order, as update() does', () => {
    const base = { beds: { R1: { patientName: 'Base', pathology: 'Base' } } };

    expect(
      projectFirestoreUpdate(base, {
        'beds.R1': { patientName: 'Entero' },
        'beds.R1.pathology': 'Hoja',
      })
    ).toEqual({ beds: { R1: { patientName: 'Entero', pathology: 'Hoja' } } });
    expect(
      projectFirestoreUpdate(base, {
        'beds.R1.pathology': 'Hoja',
        'beds.R1': { patientName: 'Entero' },
      })
    ).toEqual({ beds: { R1: { patientName: 'Entero' } } });
  });

  it.each([
    ['deleteField', () => deleteField()],
    ['serverTimestamp', () => serverTimestamp()],
    ['arrayUnion', () => arrayUnion('VVP')],
    ['arrayRemove', () => arrayRemove('VVP')],
    ['increment', () => increment(1)],
  ])('refuses the %s sentinel anywhere in the payload', (_label, sentinel) => {
    for (const payload of [
      { 'beds.R1.devices': sentinel() },
      { 'beds.R1': { devices: sentinel() } },
      { discharges: [{ id: 'mov-a', at: sentinel() }] },
    ]) {
      expect(() => projectFirestoreUpdate({}, payload)).toThrow(
        UnsupportedFirestoreUpdateProjectionError
      );
    }
  });

  it.each([
    ['a GeoPoint', new GeoPoint(-27.1, -109.4)],
    ['a Map', new Map([['a', 1]])],
    ['a custom class', new (class Ficha {})()],
    ['a function', () => 'x'],
    ['a bigint', BigInt(1)],
  ])('refuses %s instead of guessing how Firestore stored it', (_label, value) => {
    expect(() => projectFirestoreUpdate({}, { 'beds.R1.extra': value })).toThrow(
      UnsupportedFirestoreUpdateProjectionError
    );
  });

  it.each(['beds..R1', '.beds', 'beds.', '__proto__.polluted', 'beds.constructor.x', 'prototype'])(
    'refuses the path %s',
    path => {
      expect(() => projectFirestoreUpdate({}, { [path]: 'x' })).toThrow(
        UnsupportedFirestoreUpdateProjectionError
      );
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }
  );

  it('never mutates the base or the payload', () => {
    const base = deepFreeze({
      lastUpdated: Timestamp.fromMillis(0),
      beds: { R1: { patientName: 'Base', clinicalCrib: null, devices: ['VVP'] } },
      rayenSync: { runId: 'run-old' },
    });
    const payload = deepFreeze({
      'beds.R1.clinicalCrib.patientName': 'RN',
      'beds.R1.devices': ['CVC'],
      'rayenSync.runId': 'run-new',
      lastUpdated: committedAt,
    });
    const baseCopy = structuredClone({ ...base, lastUpdated: null });
    const payloadKeys = Object.keys(payload);

    const projected = projectFirestoreUpdate(base, payload);
    projected.beds.R1.patientName = 'Mutado';

    expect({ ...base, lastUpdated: null }).toEqual(baseCopy);
    expect(base.lastUpdated).toEqual(Timestamp.fromMillis(0));
    expect(Object.keys(payload)).toEqual(payloadKeys);
    expect(projected.beds.R1).toEqual({
      patientName: 'Mutado',
      clinicalCrib: { patientName: 'RN' },
      devices: ['CVC'],
    });
  });
});
