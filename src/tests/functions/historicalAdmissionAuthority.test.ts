import { expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { buildHistoricalAdmissionPatch } from '@/features/rayen-import/domain/historicalAdmissionPatch';
import { flattenObject } from '@/services/storage/firestore/firestoreShared';
import { extractDailyRecordBedTreePatch } from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import { normalizeDailyRecordInvariants } from '@/utils/recordInvariants';
import { preparePatchedRecordPersistence } from '@/services/repositories/dailyRecordPatchPersistenceController';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { createUpdatePartialDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import {
  computePreviousDayEdits,
  fileCrossDayCorrections,
} from '@/features/rayen-import/domain/previousDayCorrections';
import {
  historicalRecord,
  motherAndNewbornDiff,
  repository,
} from '../rayen-import/previousDayAdmissionCorrections.fixtures';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from './dailyRecordWriteAuthorityFunctions.test-support';

it('accepts a historical admission into an empty bed through the actual server authority', async () => {
  const record = makeRecord();
  const remote: DailyRecord = normalizeDailyRecordInvariants({
    date: record.date,
    lastUpdated: record.lastUpdated,
    activeExtraBeds: [],
    discharges: [],
    transfers: [],
    cma: [],
    beds: { R1: { ...EMPTY_PATIENT, bedId: 'R1' } },
  }).record;
  const incoming = {
    ...remote,
    beds: {
      ...remote.beds,
      R1: { ...EMPTY_PATIENT, ...record.beds.R1, bedId: 'R1', pathology: 'Current-day diagnosis' },
    },
  };
  const patch = buildHistoricalAdmissionPatch(remote, incoming);
  const prepared = preparePatchedRecordPersistence(remote, remote.date, patch);
  const wirePatch = flattenObject(prepared.mergedPatches);
  const bedPaths = Object.keys(wirePatch).filter(path => path.startsWith('beds.'));
  expect(bedPaths.every(path => path.startsWith('beds.R1.'))).toBe(true);
  expect(prepared.record.beds.R2).toEqual(remote.beds.R2);
  const { admin } = createAdminMock({
    remoteData: { ...remote },
    policyData: { schemaVersion: 2, clinicalBatchMode: 'enforced' },
  });
  const api = createDailyRecordWriteAuthorityFunctions({
    firestore: admin.firestore(),
    Timestamp: admin.firestore.Timestamp,
    resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
  });
  // Even a single manual clinical field makes the old admission payload invalid:
  // that channel requires an episode already present in the remote bed.
  await expect(
    api.patchDailyRecordWithClinicalAuthority.run(
      {
        date: remote.date,
        mode: 'enforced',
        expectedLastUpdated: remote.lastUpdated,
        patch: { ...flattenObject(patch), 'beds.R1.pathology': 'Current-day diagnosis' },
      },
      makeContext()
    )
  ).rejects.toThrow('no active clinical episode identity');
  const result = await api.patchDailyRecordWithClinicalAuthority.run(
    {
      date: remote.date,
      mode: 'enforced',
      expectedLastUpdated: remote.lastUpdated,
      patch: extractDailyRecordBedTreePatch(wirePatch),
    },
    makeContext()
  );
  expect(result.recordState.record.beds.R1.patientName).toBe(record.beds.R1.patientName);
  expect(result.recordState.record.beds.R1.clinicalEpisodeId).toBe('ep-uno');
  expect(result.recordState.record.beds.R1.pathology).toBe(remote.beds.R1.pathology);
  expect(incoming.beds.R1.pathology).toBe('Current-day diagnosis');
});

it.each([false, true])(
  'confirms historical diagnosis through server authority (crib: %s)',
  async withCrib => {
    let remote = normalizeDailyRecordInvariants({
      ...historicalRecord,
      lastUpdated: '2026-07-25T12:00:00.000Z',
    }).record;
    const originalBeds = structuredClone(remote.beds);
    const diff = structuredClone(motherAndNewbornDiff);
    if (withCrib) diff.admissions[0].patient.clinicalCrib!.pathology = 'Diagnóstico RN';
    else diff.admissions[0].patient.clinicalCrib = undefined;
    diff.admissions[0].patient.pathology = 'Diagnóstico de ingreso';
    const updatePartialDetailed: DailyRecordRepositoryPort['updatePartialDetailed'] = vi.fn(
      async (date, patch, options) => {
        expect(options?.baseRecord).toBe(remote);
        const prepared = preparePatchedRecordPersistence(remote, date, patch);
        const wirePatch = flattenObject(prepared.mergedPatches);
        if (!Object.keys(patch).some(path => path.endsWith('.pathology')))
          expect(Object.keys(wirePatch).filter(path => path.startsWith('beds.'))).toEqual(
            expect.arrayContaining(['beds.H4C1.clinicalEpisodeId'])
          );
        expect(
          Object.keys(wirePatch)
            .filter(path => path.startsWith('beds.'))
            .every(path => path.startsWith('beds.H4C1.'))
        ).toBe(true);
        const { admin } = createAdminMock({
          remoteData: { ...remote },
          policyData: { schemaVersion: 2, clinicalBatchMode: 'enforced' },
        });
        const api = createDailyRecordWriteAuthorityFunctions({
          firestore: admin.firestore(),
          Timestamp: admin.firestore.Timestamp,
          resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
        });
        const result = await api.patchDailyRecordWithClinicalAuthority.run(
          {
            date,
            mode: 'enforced',
            expectedLastUpdated: remote.lastUpdated,
            patch:
              'beds.H4C1.pathology' in patch ? patch : extractDailyRecordBedTreePatch(wirePatch),
          },
          makeContext()
        );
        remote = result.recordState.record;
        return createUpdatePartialDailyRecordResult({
          date,
          outcome: 'clean',
          savedLocally: true,
          updatedRemotely: true,
          queuedForRetry: false,
          autoMerged: false,
          patchedFields: Object.keys(wirePatch).length,
        });
      }
    );
    const port = {
      ...repository,
      getAuthoritativeForDate: vi.fn(async () => remote),
      updatePartialDetailed,
    };
    const plan = await computePreviousDayEdits(port, diff, '2026-07-26', true);
    expect(plan.edits).toHaveLength(1);
    await expect(
      fileCrossDayCorrections(
        port,
        remote,
        { ...diff, previousDayEdits: plan.edits },
        '2026-07-26',
        true,
        () => 'historical-import',
        { syncRunId: 'first-import' }
      )
    ).resolves.toEqual({ confirmed: 1, durablyQueued: 0, omitted: [] });
    expect(remote.beds.H4C1.clinicalEpisodeId).toBe(diff.admissions[0].patient.clinicalEpisodeId);
    for (const bedId of Object.keys(originalBeds).filter(id => id !== 'H4C1')) {
      expect(remote.beds[bedId]).toEqual(originalBeds[bedId]);
    }
    expect((await computePreviousDayEdits(port, diff, '2026-07-26', true)).edits).toEqual([]);
    expect(remote.beds.H4C1.pathology).toBe('Diagnóstico de ingreso');
    if (withCrib) expect(remote.beds.H4C1.clinicalCrib?.pathology).toBe('Diagnóstico RN');
    expect(updatePartialDetailed).toHaveBeenCalledTimes(withCrib ? 3 : 2);
  }
);
