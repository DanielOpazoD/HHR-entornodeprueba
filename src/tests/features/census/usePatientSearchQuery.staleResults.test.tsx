import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePatientSearchQuery } from '@/features/census/components/global-search/usePatientSearchQuery';
import type { MasterPatient } from '@/types/domain/patientMaster';

const searchMasterPatients = vi.hoisted(() => vi.fn());

vi.mock('@/application/census/searchMasterPatientsUseCase', () => ({ searchMasterPatients }));

const patient = { rut: '11111111-1', fullName: 'ALFA SINTETICA' } as MasterPatient;

const deferredSearch = () => {
  let resolve: (value: unknown) => void = () => undefined;
  searchMasterPatients.mockReturnValueOnce(new Promise(done => (resolve = done)));
  return () => resolve({ status: 'success', data: [patient] });
};

describe('usePatientSearchQuery: a search that is no longer on screen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    searchMasterPatients.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not show the patients of a longer query after the query is shortened below two letters', async () => {
    const answer = deferredSearch();
    const { result } = renderHook(() => usePatientSearchQuery());

    act(() => result.current.setQuery('al'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(searchMasterPatients).toHaveBeenCalledTimes(1);

    act(() => result.current.setQuery('a'));
    await act(async () => {
      answer();
      await vi.runAllTimersAsync();
    });

    expect(result.current.results).toEqual([]);
    expect(result.current.hasSearched).toBe(false);
    expect(result.current.isSearching).toBe(false);
  });

  it('still shows the patients of the query that is on screen', async () => {
    const answer = deferredSearch();
    const { result } = renderHook(() => usePatientSearchQuery());

    act(() => result.current.setQuery('al'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
      answer();
      await vi.runAllTimersAsync();
    });

    expect(result.current.results).toEqual([patient]);
    expect(result.current.hasSearched).toBe(true);
    expect(result.current.isSearching).toBe(false);
  });
});
