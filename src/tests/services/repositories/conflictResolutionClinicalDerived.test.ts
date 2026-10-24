/**
 * Conflict auto-merge on split days (D9 of DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md): the
 * marker and, on a marked remote, `meta` and the moved clinical fields come only from the remote,
 * so a pre-split local copy never resurrects an embedded copy that the server already moved out.
 * Unmarked days keep today's merge. Synthetic data only.
 */
import { describe, expect, it } from 'vitest';
import {
  resolveDailyRecordConflict,
  resolveDailyRecordConflictWithTrace,
} from '@/services/repositories/conflictResolutionMatrix';
import type { DailyRecord } from '@/types/domain/dailyRecord';

type Holder = Record<string, unknown>;

const DATE = '2026-11-02';
const marker = { version: 1, generation: 'gen_synthetic_a' };

const moved = (label: string) => ({
  clinicalSyncCheckpoint: {
    version: 3,
    fingerprintVersion: 1,
    sources: { vitals: { watermark: label } },
  },
  vitalSignsHistory: [
    { recordedDate: DATE, recordedAt: `${DATE}T08:00:00`, heartRate: 80, author: label },
  ],
});

const patient = (clinicalEpisodeId: string, extra: Holder = {}): Holder => ({
  bedId: 'R1',
  patientName: `Paciente sintético ${clinicalEpisodeId}`,
  rut: '11.111.111-1',
  clinicalEpisodeId,
  ...extra,
});

const record = (
  lastUpdated: string,
  beds: Record<string, Holder>,
  extra: Holder = {}
): DailyRecord =>
  ({
    date: DATE,
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated,
    nurses: [],
    activeExtraBeds: [],
    ...extra,
  }) as unknown as DailyRecord;

const holder = (value: DailyRecord, bedId: string, crib = false): Holder => {
  const bed = (value.beds as unknown as Record<string, Holder>)[bedId];
  return crib ? (bed.clinicalCrib as Holder) : bed;
};

// The remote was split after the local copy was read: ep_a lives in its document (nothing
// embedded), ep_b's newborn is not split yet (its embedded copy is the only one).
const splitRemote = () =>
  record(
    `${DATE}T10:00:00.000Z`,
    {
      R1: patient('ep_a', { handoffNote: 'remota' }),
      R2: patient('ep_b', { bedId: 'R2', clinicalCrib: patient('ep_b_rn', moved('remote-rn')) }),
    },
    { clinicalDerivedLayout: marker, meta: { revision: 8 } }
  );

// Newer local copy taken before the split: it still embeds every moved field.
const preSplitLocal = () =>
  record(
    `${DATE}T10:05:00.000Z`,
    {
      R1: patient('ep_a', { ...moved('local-a'), handoffNote: 'local' }),
      R2: patient('ep_b', {
        bedId: 'R2',
        ...moved('local-b'),
        clinicalCrib: patient('ep_b_rn', moved('local-rn')),
      }),
    },
    { meta: { revision: 6 } }
  );

describe('conflict auto-merge of a pre-split local copy against a split remote', () => {
  it.each([
    ['the whole record', ['*']],
    ['a moved-field path', ['beds.R1.vitalSignsHistory', 'beds.R2.clinicalSyncCheckpoint']],
    ['a whole bed', ['beds.R1', 'beds.R2']],
  ])(
    'takes moved fields, marker and meta only from the remote when merging %s',
    (_label, paths) => {
      const { record: merged, trace } = resolveDailyRecordConflictWithTrace(
        splitRemote(),
        preSplitLocal(),
        { changedPaths: paths }
      );

      expect(merged.clinicalDerivedLayout).toEqual(marker);
      expect((merged as unknown as { meta: unknown }).meta).toEqual({ revision: 8 });
      // Absent on the remote = absent in the result: no resurrected embedded copy.
      ['R1', 'R2'].forEach(bedId => {
        expect('vitalSignsHistory' in holder(merged, bedId)).toBe(false);
        expect('clinicalSyncCheckpoint' in holder(merged, bedId)).toBe(false);
      });
      // The newborn's only (embedded) copy is kept, from the remote.
      expect(holder(merged, 'R2', true)).toMatchObject(moved('remote-rn'));
      expect(trace.entries).toContainEqual({
        path: 'clinicalDerivedLayout',
        strategy: 'copy_remote_value',
        winner: 'remote',
        reason: 'clinical_derived_remote_only',
      });
    }
  );

  it('still merges every other field as before (the newer local narrative wins)', () => {
    const merged = resolveDailyRecordConflict(splitRemote(), preSplitLocal(), {
      changedPaths: ['*'],
    });
    expect(holder(merged, 'R1').handoffNote).toBe('local');
    expect(merged.lastUpdated).toBe(`${DATE}T10:05:00.000Z`);
  });

  it('drops a local marker when the remote day has none', () => {
    const local = record(
      `${DATE}T10:05:00.000Z`,
      { R1: patient('ep_a') },
      { clinicalDerivedLayout: marker }
    );
    const merged = resolveDailyRecordConflict(
      record(`${DATE}T10:00:00.000Z`, { R1: patient('ep_a') }),
      local,
      {
        changedPaths: ['*'],
      }
    );
    expect('clinicalDerivedLayout' in merged).toBe(false);
  });
});

describe('conflict auto-merge on unmarked days', () => {
  it('keeps today’s merge: a local moved field survives when the remote lacks it', () => {
    const remote = record(
      `${DATE}T10:00:00.000Z`,
      { R1: patient('ep_a') },
      { meta: { revision: 8 } }
    );
    const local = record(`${DATE}T10:05:00.000Z`, { R1: patient('ep_a', moved('local-a')) });
    const { record: merged, trace } = resolveDailyRecordConflictWithTrace(remote, local, {
      changedPaths: ['beds.R1.vitalSignsHistory'],
    });

    expect(holder(merged, 'R1').vitalSignsHistory).toEqual(moved('local-a').vitalSignsHistory);
    expect('clinicalDerivedLayout' in merged).toBe(false);
    expect(trace.entries.map(entry => entry.reason)).not.toContain('clinical_derived_remote_only');
  });

  it('keeps today’s per-field policy for both moved fields', () => {
    const remote = record(`${DATE}T10:00:00.000Z`, { R1: patient('ep_a', moved('remote-a')) });
    const local = record(`${DATE}T10:05:00.000Z`, { R1: patient('ep_a', moved('local-a')) });
    const merged = resolveDailyRecordConflict(remote, local, { changedPaths: ['*'] });
    // vitalSignsHistory is remote-canonical and the checkpoint merges by id, exactly as before.
    expect(holder(merged, 'R1').vitalSignsHistory).toEqual(moved('remote-a').vitalSignsHistory);
    expect(holder(merged, 'R1').clinicalSyncCheckpoint).toEqual(
      moved('local-a').clinicalSyncCheckpoint
    );
  });
});
