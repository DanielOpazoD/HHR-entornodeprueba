import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PatientData } from '@/features/census/contracts/censusPatientContracts';
const query = vi.hoisted(() => vi.fn());
vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestoreDetailed: query,
}));
import { useSpecialtyRuleSources } from '@/features/census/components/specialty-round/useSpecialtyRuleSources';
const beds = { R1: { patientName: 'Paciente sintético', cie10Code: 'F23' } } as Record<
  string,
  PatientData
>;

describe('hospitalized diagnosis source', () => {
  beforeEach(() => vi.clearAllMocks());
  it('keeps the selected census when today has not been created, without a false read error', async () => {
    query.mockResolvedValue({ status: 'missing', record: null });
    const { result } = renderHook(() => useSpecialtyRuleSources('2026-10-15', beds, '2026-10-16'));
    await waitFor(() => expect(query).toHaveBeenCalledOnce());
    expect(result.current.currentBeds).toEqual(beds);
    expect(result.current.currentDate).toBe('2026-10-15');
    expect(result.current.currentError).toBe(false);
  });
  it('permits retry and removes a stale remote error when returning to the current census', async () => {
    query.mockResolvedValue({ status: 'failed', record: null });
    const { result, rerender } = renderHook(
      ({ date }) => useSpecialtyRuleSources(date, beds, '2026-10-16'),
      { initialProps: { date: '2026-10-15' } }
    );
    await waitFor(() => expect(result.current.currentError).toBe(true));
    expect(result.current.currentBeds).toEqual(beds);
    query.mockResolvedValue({ status: 'resolved', record: { beds: { R2: beds.R1 } } });
    act(() => result.current.retryCurrent());
    await waitFor(() => expect(result.current.currentDate).toBe('2026-10-16'));
    rerender({ date: '2026-10-16' });
    expect(result.current.currentError).toBe(false);
    expect(result.current.currentBeds).toEqual(beds);
  });
  it('ignores an old remote response after changing census dates', async () => {
    let resolve!: (value: unknown) => void;
    query.mockReturnValue(
      new Promise(done => {
        resolve = done;
      })
    );
    const { result, rerender } = renderHook(
      ({ date }) => useSpecialtyRuleSources(date, beds, '2026-10-16'),
      { initialProps: { date: '2026-10-15' } }
    );
    await waitFor(() => expect(query).toHaveBeenCalledOnce());
    rerender({ date: '2026-10-16' });
    await act(async () => resolve({ status: 'resolved', record: { beds: { R2: beds.R1 } } }));
    expect(result.current.currentBeds).toEqual(beds);
  });
});
