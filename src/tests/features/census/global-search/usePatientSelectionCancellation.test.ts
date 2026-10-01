import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MasterPatient } from '@/types/domain/patientMaster';
const read = vi.hoisted(() => vi.fn());
vi.mock('@/services/patient/patientHistoryService', () => ({
  getPatientMovementHistoryDetailed: read,
}));
import { usePatientSelection } from '@/features/census/components/global-search/usePatientSelection';

const patient: MasterPatient = {
  rut: 'synthetic-1',
  fullName: 'Paciente de prueba',
  forecast: 'Fonasa',
  gender: 'Femenino',
  birthDate: '1980-01-01',
  createdAt: 1,
  updatedAt: 1,
  hospitalizations: [],
};

describe('patient history selection cancellation', () => {
  beforeEach(() => vi.resetAllMocks());
  it('aborts an abandoned lookup without caching its late completion', async () => {
    let finish!: (value: { history: null; source: 'server' }) => void;
    read.mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      })
    );
    const { result } = renderHook(() => usePatientSelection());
    act(() => {
      void result.current.selectPatient(patient);
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const signal = read.mock.calls[0][1].signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    act(() => result.current.clearSelection());
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish({ history: null, source: 'server' });
    });
    expect(result.current.selectedPatient).toBeNull();
    read.mockResolvedValue({ history: null, source: 'server' });
    await act(async () => {
      await result.current.selectPatient(patient);
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('aborts on unmount and ignores late progress from the abandoned lookup', async () => {
    read.mockReturnValue(new Promise(() => {}));
    const { result, unmount } = renderHook(() => usePatientSelection());
    act(() => {
      void result.current.selectPatient(patient);
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const options = read.mock.calls[0][1];
    act(() => options.onProgress(20));
    expect(result.current.selectedPatient?.historyRecordsRead).toBe(20);
    expect(result.current.selectedPatient?.history).toBeNull();
    expect(result.current.selectedPatient?.isLoadingHistory).toBe(true);
    unmount();
    expect(options.signal.aborted).toBe(true);
    act(() => options.onProgress(999));
  });

  it('keeps progress and completion owned by the latest version of the same patient', async () => {
    const completions: Array<(value: { history: null; source: 'server' }) => void> = [];
    read.mockImplementation(
      () =>
        new Promise(resolve => {
          completions.push(resolve);
        })
    );
    const { result } = renderHook(() => usePatientSelection());
    act(() => {
      void result.current.selectPatient(patient);
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const older = read.mock.calls[0][1];
    const latest = { ...patient, updatedAt: 2, fullName: 'Versión más reciente' };
    act(() => {
      void result.current.selectPatient(latest);
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(older.signal.aborted).toBe(true);
    act(() => {
      older.onProgress(999);
      read.mock.calls[1][1].onProgress(20);
    });
    expect(result.current.selectedPatient?.historyRecordsRead).toBe(20);
    await act(async () => {
      completions[1]({ history: null, source: 'server' });
    });
    await act(async () => {
      completions[0]({ history: null, source: 'server' });
    });
    expect(result.current.selectedPatient?.master).toEqual(latest);
    expect(result.current.selectedPatient?.isLoadingHistory).toBe(false);
    await act(async () => {
      await result.current.selectPatient(latest);
    });
    expect(read).toHaveBeenCalledTimes(2);
    act(() => {
      void result.current.selectPatient(patient);
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  });

  it('retains same-patient deduplication after a reset while the old request finishes late', async () => {
    const completions: Array<(value: { history: null; source: 'server' }) => void> = [];
    read.mockImplementation(
      () =>
        new Promise(resolve => {
          completions.push(resolve);
        })
    );
    const { result } = renderHook(() => usePatientSelection());
    act(() => {
      void result.current.selectPatient(patient);
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const signal = read.mock.calls[0][1].signal;
    act(() => {
      result.current.resetSelection();
      void result.current.selectPatient(patient);
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(signal.aborted).toBe(true);
    await act(async () => {
      completions[0]({ history: null, source: 'server' });
    });
    act(() => {
      void result.current.selectPatient(patient);
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await act(async () => {
      completions[1]({ history: null, source: 'server' });
    });
    expect(result.current.selectedPatient?.isLoadingHistory).toBe(false);
  });
});
