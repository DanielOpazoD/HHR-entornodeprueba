import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.unmock('@/application/ports/dailyRecordPort');

const remote = vi.hoisted(() => ({
  enabled: false,
  dates: vi.fn(async (): Promise<string[]> => []),
}));
vi.mock('@/services/repositories/repositoryConfig', async importOriginal => ({
  ...(await importOriginal<object>()),
  isFirestoreEnabled: () => remote.enabled,
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal => ({
  ...(await importOriginal<object>()),
  getAvailableDatesFromFirestore: remote.dates,
}));

import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { getAvailableDates } from '@/services/repositories/dailyRecordRepositoryReadService';
import { auditAdmissionDateBackfill } from '@/services/admin/admissionDateBackfillService';
import { executeAnalyzePatients } from '@/application/patient-flow/patientAnalysisUseCase';
import { defaultDailyRecordAnalysisPort } from '@/application/ports/dailyRecordPort';

const failure = new Error('synthetic local index unavailable');
const failLocalIndex = () =>
  vi.spyOn(hospitalDB.dailyRecords, 'orderBy').mockImplementation(() => {
    throw failure;
  });

beforeEach(async () => {
  remote.enabled = false;
  remote.dates.mockReset();
  remote.dates.mockResolvedValue([]);
  await hospitalDB.dailyRecords.clear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await hospitalDB.dailyRecords.clear();
});

describe('census date index that could not be read', () => {
  it('blocks the admission-date audit instead of reporting zero days as clean', async () => {
    await hospitalDB.dailyRecords.put(DataFactory.createMockDailyRecord('2026-10-01'));
    failLocalIndex();

    const result = await auditAdmissionDateBackfill();

    expect(result.outcome).toBe('blocked');
    expect(result.scannedDays).toBe(0);
    expect(result.userSafeMessage).toMatch(/lista de días/);
  });

  it('fails the patient analysis instead of reporting a history without records', async () => {
    await hospitalDB.dailyRecords.put(DataFactory.createMockDailyRecord('2026-10-01'));
    failLocalIndex();

    const outcome = await executeAnalyzePatients({
      dailyRecordRepository: defaultDailyRecordAnalysisPort,
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.data).toBeNull();
  });

  it('does not hand out the local days alone as the whole history when the server list fails', async () => {
    remote.enabled = true;
    remote.dates.mockRejectedValue(new Error('synthetic server list unavailable'));
    await hospitalDB.dailyRecords.put(DataFactory.createMockDailyRecord('2026-10-01'));

    await expect(getAvailableDates()).rejects.toMatchObject({
      status: 'partial',
      unavailableSources: ['remote'],
    });
  });

  it('does not hand out the server days alone as the whole history when the local list fails', async () => {
    remote.enabled = true;
    remote.dates.mockResolvedValue(['2026-10-02']);
    failLocalIndex();

    await expect(getAvailableDates()).rejects.toMatchObject({
      status: 'partial',
      unavailableSources: ['local'],
    });
  });

  it('reports the index unavailable when neither list can be read', async () => {
    remote.enabled = true;
    remote.dates.mockRejectedValue(new Error('synthetic server list unavailable'));
    failLocalIndex();

    await expect(getAvailableDates()).rejects.toMatchObject({
      status: 'unavailable',
      unavailableSources: ['local', 'remote'],
    });
  });
});

describe('census date index that was read', () => {
  it('still audits a genuinely empty history as clean', async () => {
    const result = await auditAdmissionDateBackfill();

    expect(result.outcome).toBe('clean');
    expect(result.scannedDays).toBe(0);
  });

  it('lists the local days without a server', async () => {
    await hospitalDB.dailyRecords.bulkPut([
      DataFactory.createMockDailyRecord('2026-10-01'),
      DataFactory.createMockDailyRecord('2026-10-03'),
    ]);

    await expect(getAvailableDates()).resolves.toEqual(['2026-10-03', '2026-10-01']);
    const result = await auditAdmissionDateBackfill();
    expect(result.scannedDays).toBe(2);
  });

  it('merges local and server days when both lists are read', async () => {
    remote.enabled = true;
    remote.dates.mockResolvedValue(['2026-10-02', '2026-10-01']);
    await hospitalDB.dailyRecords.put(DataFactory.createMockDailyRecord('2026-10-03'));

    await expect(getAvailableDates()).resolves.toEqual(['2026-10-03', '2026-10-02', '2026-10-01']);
  });
});
