// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { canReplayByField, fieldReplayPaths } from '@/services/storage/sync/taskFieldReplay';
import { UNKNOWN_SERVER_VERSION } from '@/services/storage/sync/syncTaskContractPolicy';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

/** A queued day write of `changes`, each with its captured base, from a known server version. */
const dayTask = (
  changes: Record<string, unknown>,
  overrides: Partial<SyncTask> = {}
): SyncTask => ({
  opId: 'synthetic-op',
  type: 'UPDATE_DAILY_RECORD',
  payload: {},
  timestamp: 0,
  retryCount: 0,
  status: 'PENDING',
  patchBaseValues: changes,
  syncContract: {
    expectedVersion: '2026-11-15T12:00:00.000Z',
    changedPaths: Object.keys(changes),
  },
  ...overrides,
});

describe('which queued day writes resend as the same edit made online', () => {
  it('takes plain day fields that carry their base and a known version', () => {
    expect(
      fieldReplayPaths(
        dayTask({ handoffNovedadesDayShift: 'BASE', activeExtraBeds: [], dateTimestamp: 1 })
      )
    ).toEqual(['handoffNovedadesDayShift', 'activeExtraBeds', 'dateTimestamp']);
  });

  // Each of them is checked against its base and then saved by its own route (W22-SAVE-B).
  it.each([
    ['a bed field', { 'beds.R1.age': '40' }],
    [
      'a bed field next to a plain one',
      { 'beds.R1.pathology': 'BASE', handoffNovedadesDayShift: '' },
    ],
    ['a field of the crib', { 'beds.R1.clinicalCrib.pathology': '' }],
    ['a bed type override', { 'bedTypeOverrides.R1': 'UTI' }],
    ['staffing', { nursesDayShift: ['ENFERMERA BASE', ''] }],
  ])('takes %s', (_label, changes) => {
    expect(fieldReplayPaths(dayTask(changes))).toEqual(Object.keys(changes));
  });

  it.each([
    ['a whole bed', { 'beds.R1': {} }],
    ['a whole crib', { 'beds.R1.clinicalCrib': {} }],
    ['a movement list', { discharges: [] }],
    ['an entry of a movement list', { 'transfers.0': {} }],
    ['the CMA list next to a bed field', { cma: [], 'beds.R1.age': '40' }],
  ])('keeps %s on the whole-day publish', (_label, changes) => {
    expect(fieldReplayPaths(dayTask(changes))).toBeUndefined();
  });

  it('keeps the old route without a base for every field or a known version', () => {
    expect(
      fieldReplayPaths(
        dayTask(
          { handoffNovedadesDayShift: 'BASE' },
          { patchBaseValues: {}, syncContract: { changedPaths: ['handoffNovedadesDayShift'] } }
        )
      )
    ).toBeUndefined();
    for (const expectedVersion of [undefined, UNKNOWN_SERVER_VERSION, 'not a date'])
      expect(
        fieldReplayPaths(
          dayTask(
            { handoffNovedadesDayShift: 'BASE' },
            {
              syncContract: { expectedVersion, changedPaths: ['handoffNovedadesDayShift'] },
            }
          )
        )
      ).toBeUndefined();
    expect(fieldReplayPaths(dayTask({ '*': null }))).toBeUndefined();
    expect(
      fieldReplayPaths(
        dayTask({ handoffNovedadesDayShift: 'BASE' }, { nursingHandoffRecovery: true })
      )
    ).toBeUndefined();
  });
});

describe('which fields resend by field once checked against the stored day', () => {
  const day = (beds: Record<string, object>, extra: object = {}) => ({ beds, ...extra }) as never;
  const newborn = (clinicalEpisodeId: string, patientName = 'RN PROVISIONAL SINTETICO') => ({
    patientName,
    rut: '',
    documentType: 'RUT',
    clinicalEpisodeId,
  });
  const check = (changes: Record<string, unknown>, queued: never, stored: never, extra = {}) => {
    const task = dayTask(changes, extra);
    return canReplayByField(task, Object.keys(changes), queued, stored);
  };

  it('takes a scalar of a bed, a day field and staffing alone', () => {
    const bed = day({ R1: { pathology: 'B' } });
    expect(check({ 'beds.R1.pathology': 'A' }, bed, bed)).toBe(true);
    expect(check({ 'beds.R1.pathology': 'A', handoffNovedadesDayShift: '' }, bed, bed)).toBe(true);
    expect(check({ nursesDayShift: [], tensDayShift: [] }, bed, bed)).toBe(true);
  });

  it('keeps one authority write: never structural with clinical, nor staffing with a bed', () => {
    const bed = day({ R1: { pathology: 'B', age: '40' } });
    expect(check({ 'beds.R1.pathology': 'A', 'beds.R1.age': '41' }, bed, bed)).toBe(false);
    expect(check({ 'beds.R1.age': '41', nursesDayShift: [] }, bed, bed)).toBe(false);
  });

  // Review of #1859: main merges these item by item; a field write would drop the other side's.
  it.each([
    ['handoff entries', 'beds.R1.medicalHandoffEntries'],
    ['a crib handoff note', 'beds.R1.clinicalCrib.medicalHandoffNote'],
    ['clinical events', 'beds.R1.clinicalEvents'],
    ['the medical summary', 'medicalHandoffNovedades'],
    ['a specialty summary', 'medicalHandoffBySpecialty.cirugia'],
  ])('leaves %s to the whole-day publish', (_label, path) => {
    const bed = day({ R1: {} });
    expect(check({ [path]: [] }, bed, bed)).toBe(false);
  });

  // Review of #1859: the field write flattens a map, so a renamed key would stay.
  it('takes a map only when it loses no key', () => {
    const details = (keys: string[]) =>
      day({ R1: { deviceDetails: Object.fromEntries(keys.map(key => [key, { note: key }])) } });
    const renamed = details(['CVC', 'Drenaje pleural derecho']);
    const before = details(['CVC', 'Drenaje derecho']);
    const path = 'beds.R1.deviceDetails';
    expect(check({ [path]: {} }, renamed, before)).toBe(false);
    expect(check({ [path]: {} }, details(['CVC', 'Drenaje derecho', 'SNG']), before)).toBe(true);
  });

  // ID-01 (review of #1859): the same provisional name and derived id are not the same newborn.
  it('takes an edit of who a slot holds only as an admission into a slot still empty', () => {
    const path = 'beds.R1.clinicalCrib.patientName';
    const crib = day({ R1: { patientName: 'MADRE', clinicalCrib: newborn('legacy_ep_rn') } });
    const context = (episode: string) => ({
      patchBaseContext: Object.fromEntries(
        Object.entries(newborn(episode)).map(([field, value]) => [
          `beds.R1.clinicalCrib.${field}`,
          value,
        ])
      ),
    });
    expect(check({ [path]: 'RN' }, crib, crib, context('legacy_ep_rn'))).toBe(false);
    const empty = day({ R1: { patientName: '', rut: '' } });
    const admitted = day({ R1: { patientName: 'NUEVO', rut: '11.111.111-1' } });
    const admission = { 'beds.R1.patientName': '', 'beds.R1.rut': '' };
    expect(check(admission, admitted, empty, { patchBaseContext: {} })).toBe(true);
    expect(check(admission, admitted, admitted, { patchBaseContext: {} })).toBe(false);
    expect(check(admission, admitted, empty)).toBe(false);
  });
});
