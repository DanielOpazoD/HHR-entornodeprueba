import { describe, expect, it } from 'vitest';
import { plainDayFieldReplayPaths } from '@/services/storage/sync/plainDayFieldReplay';
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

describe('which queued day writes resend through the per-field check', () => {
  it('takes plain day fields that carry their base and a known version', () => {
    expect(
      plainDayFieldReplayPaths(
        dayTask({ handoffNovedadesDayShift: 'BASE', activeExtraBeds: [], dateTimestamp: 1 })
      )
    ).toEqual(['handoffNovedadesDayShift', 'activeExtraBeds', 'dateTimestamp']);
  });

  // A bed may hold another patient or episode by now (ID-01): never accepted by value.
  it.each([
    ['a bed field', { 'beds.R1.age': '40' }],
    [
      'a bed field next to a plain one',
      { 'beds.R1.pathology': 'BASE', handoffNovedadesDayShift: '' },
    ],
    ['a whole bed', { 'beds.R1': {} }],
    ['a bed type override', { 'bedTypeOverrides.R1': 'UTI' }],
    ['staffing', { nursesDayShift: ['ENFERMERA BASE', ''] }],
    ['a movement list', { discharges: [] }],
    ['an entry of a movement list', { 'transfers.0': {} }],
    ['the CMA list', { cma: [] }],
  ])('keeps %s on its own version check', (_label, changes) => {
    expect(plainDayFieldReplayPaths(dayTask(changes))).toBeUndefined();
  });

  it('keeps the old route without a base for every field or a known version', () => {
    expect(
      plainDayFieldReplayPaths(
        dayTask(
          { handoffNovedadesDayShift: 'BASE' },
          { patchBaseValues: {}, syncContract: { changedPaths: ['handoffNovedadesDayShift'] } }
        )
      )
    ).toBeUndefined();
    for (const expectedVersion of [undefined, UNKNOWN_SERVER_VERSION, 'not a date'])
      expect(
        plainDayFieldReplayPaths(
          dayTask(
            { handoffNovedadesDayShift: 'BASE' },
            {
              syncContract: { expectedVersion, changedPaths: ['handoffNovedadesDayShift'] },
            }
          )
        )
      ).toBeUndefined();
    expect(plainDayFieldReplayPaths(dayTask({ '*': null }))).toBeUndefined();
    expect(
      plainDayFieldReplayPaths(
        dayTask({ handoffNovedadesDayShift: 'BASE' }, { nursingHandoffRecovery: true })
      )
    ).toBeUndefined();
  });
});
