// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fieldReplayPaths, keepsEditedOccupants } from '@/services/storage/sync/taskFieldReplay';
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

describe('an edit of who a bed or crib holds resends by field only for that same patient', () => {
  const newborn = (clinicalEpisodeId: string, patientName = 'RN PROVISIONAL SINTETICO') => ({
    patientName,
    rut: '',
    documentType: 'RUT',
    clinicalEpisodeId,
  });
  const dayWith = (crib: object) =>
    ({ beds: { R1: { patientName: 'MADRE SINTETICA', clinicalCrib: crib } } }) as never;
  const nameTask = dayTask(
    { 'beds.R1.clinicalCrib.patientName': 'RN PROVISIONAL SINTETICO' },
    {
      patchBaseContext: Object.fromEntries(
        Object.entries(newborn('ep_rn_a')).map(([field, value]) => [
          `beds.R1.clinicalCrib.${field}`,
          value,
        ])
      ),
    }
  );
  const queued = dayWith(newborn('ep_rn_a', 'NOMBRE DEL PRIMER RN'));

  it('takes a name correction while the crib holds the newborn it was written for', () => {
    expect(keepsEditedOccupants(nameTask, queued, dayWith(newborn('ep_rn_a')))).toBe(true);
  });

  // ID-01: the same provisional name is not the same newborn.
  it('leaves it to the whole-day publish once the crib holds another newborn', () => {
    expect(keepsEditedOccupants(nameTask, queued, dayWith(newborn('ep_rn_b')))).toBe(false);
  });

  it('takes an admission while the bed stays empty, and an edit of another field as it is', () => {
    const admission = dayTask(
      { 'beds.R1.patientName': '', 'beds.R1.rut': '' },
      { patchBaseContext: {} }
    );
    const empty = { beds: { R1: { patientName: '', rut: '' } } } as never;
    expect(keepsEditedOccupants(admission, empty, empty)).toBe(true);
    expect(keepsEditedOccupants(dayTask({ 'beds.R1.age': '40' }), queued, empty)).toBe(true);
    expect(keepsEditedOccupants({ ...nameTask, patchBaseContext: undefined }, queued, queued)).toBe(
      false
    );
  });
});
