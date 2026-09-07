import { expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { buildHistoricalAdmissionBedsPatch } from '@/features/rayen-import/domain/historicalAdmissionPatch';
import { flattenObject } from '@/services/storage/firestore/firestoreShared';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from './dailyRecordWriteAuthorityFunctions.test-support';

it('accepts a historical admission into an empty bed through the actual server authority', async () => {
  const record = makeRecord();
  const remote: DailyRecord = {
    date: record.date,
    lastUpdated: record.lastUpdated,
    activeExtraBeds: [],
    discharges: [],
    transfers: [],
    cma: [],
    beds: { R1: { ...EMPTY_PATIENT, bedId: 'R1' } },
  };
  const incoming = {
    ...remote,
    beds: {
      R1: { ...EMPTY_PATIENT, ...record.beds.R1, bedId: 'R1', pathology: 'Current-day diagnosis' },
    },
  };
  const beds = buildHistoricalAdmissionBedsPatch(remote, incoming);
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
        patch: { ...flattenObject({ beds }), 'beds.R1.pathology': 'Current-day diagnosis' },
      },
      makeContext()
    )
  ).rejects.toThrow('no active clinical episode identity');
  const result = await api.patchDailyRecordWithClinicalAuthority.run(
    {
      date: remote.date,
      mode: 'enforced',
      expectedLastUpdated: remote.lastUpdated,
      patch: flattenObject({ beds }),
    },
    makeContext()
  );
  expect(result.recordState.record.beds.R1.patientName).toBe(record.beds.R1.patientName);
  expect(result.recordState.record.beds.R1.clinicalEpisodeId).toBe('ep-uno');
  expect(result.recordState.record.beds.R1.pathology).toBe(remote.beds.R1.pathology);
  expect(incoming.beds.R1.pathology).toBe('Current-day diagnosis');
});
