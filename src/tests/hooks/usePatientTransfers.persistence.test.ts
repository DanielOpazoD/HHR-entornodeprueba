import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePatientTransfers } from '@/hooks/usePatientTransfers';
import { DataFactory } from '@/tests/factories/DataFactory';
import type {
  DailyRecord,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';

vi.mock('@/context/AuditContext', () => ({
  useAuditContext: () => ({ logEvent: vi.fn(), logPatientTransfer: vi.fn() }),
}));

describe('transfer inline persistence', () => {
  it('reports failed persistence to the inline editor', async () => {
    const record = {
      ...DataFactory.createMockDailyRecord('2026-11-04'),
      transfers: [{ id: 'transfer-1', patientName: 'Sintético', time: '' }],
    } as unknown as DailyRecord;
    const save = vi
      .fn<PersistDailyRecord>()
      .mockRejectedValueOnce(new Error('Synthetic save failure'));
    const { result } = renderHook(() => usePatientTransfers(record, save));
    let saved;
    await act(async () => {
      saved = await result.current.updateTransfer('transfer-1', {
        receivingCenter: 'Centro Sintético',
      });
    });
    expect(saved).toBe(false);
  });
});
