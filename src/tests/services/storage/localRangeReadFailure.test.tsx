import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB, ensureDbReady } from '@/services/storage/indexeddb/indexedDbCore';
import { getRecordsRange } from '@/services/storage/indexeddb/indexedDbRecordService';
import {
  doStoredDaysHavePatientData,
  fetchRecordsRangeSorted,
} from '@/services/records/recordQueryService';
import { loadPatientUpcHistory } from '@/services/patient/patientUpcHistoryService';
import { loadPatientHistoryRecords } from '@/services/patient/patientHistoryRecordLoader';
import { useExistingDaysQuery } from '@/hooks/useExistingDaysQuery';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => false }));
const date = '2026-04-02';
const failRead = () =>
  vi
    .spyOn(hospitalDB.Collection.prototype, 'toArray')
    .mockRejectedValue(new Error('synthetic range failure'));

describe('failed real local range reads', () => {
  beforeEach(async () => {
    await ensureDbReady();
    await hospitalDB.dailyRecords.clear();
  });
  afterEach(() => vi.restoreAllMocks());
  it('preserves empty ranges and inclusive boundaries', async () => {
    expect(await getRecordsRange(date, date)).toEqual([]);
    await hospitalDB.dailyRecords.bulkPut(
      ['2026-04-01', date, '2026-04-03'].map(day => DataFactory.createMockDailyRecord(day))
    );
    expect((await getRecordsRange(date, '2026-04-03')).map(r => r.date)).toEqual([
      date,
      '2026-04-03',
    ]);
  });
  it('rejects calendar decisions, statistics and general history instead of absence', async () => {
    failRead();
    await expect(doStoredDaysHavePatientData([date])).rejects.toThrow('synthetic');
    await expect(fetchRecordsRangeSorted(date, date)).rejects.toThrow('synthetic');
    await expect(
      loadPatientHistoryRecords({ dateRange: { startDate: date, endDate: date } })
    ).rejects.toThrow('synthetic');
  });
  it('reports local UPC history unavailable while retaining the current evaluation', async () => {
    const patient = DataFactory.createMockPatient('R1', {
      admissionDate: date,
      clinicalEpisodeId: 'synthetic-episode',
      upcChecklist: {
        evaluationId: 'current',
        uciCriteria: [],
        utiCriteria: [],
        classification: null,
        evaluatedAt: '2026-04-02T12:00:00Z',
      },
    });
    failRead();
    const result = await loadPatientUpcHistory(patient, date);
    expect(result.warning).toContain('historial local');
    expect(result.entries.map(e => e.evaluationId)).toEqual(['current']);
  });
  it('retains cached calendar markers after a saved-day range failure and failed rescan', async () => {
    const { queryClient, wrapper } = createQueryClientTestWrapper();
    queryClient.setQueryData(['existingDays', 2026, 3], [2]);
    const { result, unmount } = renderHook(() => useExistingDaysQuery(2026, 3), { wrapper });
    const read = failRead();
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('daily-record-store-changed', {
          detail: { operation: 'save', dates: [date] },
        })
      );
    });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(read).toHaveBeenCalled();
    expect(result.current.data).toEqual([2]);
    unmount();
    queryClient.clear();
  });
});
