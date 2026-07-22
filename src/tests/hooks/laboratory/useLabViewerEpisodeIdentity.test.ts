import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/features/laboratory/hooks/useLabViewer');

const mockSearchSyslabExams = vi.fn();
const mockGetPatientByRut = vi.fn();

vi.mock('@/services/laboratory/syslabService', () => ({
  searchSyslabExams: (...args: unknown[]) => mockSearchSyslabExams(...args),
  fetchSyslabExamDetails: vi.fn(),
  fetchSyslabPdfArrayBuffer: vi.fn(),
  buildSyslabPdfUrl: (link: string) => link,
}));

vi.mock('@/services/repositories/PatientMasterRepository', () => ({
  getPatientByRut: (...args: unknown[]) => mockGetPatientByRut(...args),
}));

vi.mock('@/config/queryClient', () => ({
  queryKeys: {
    laboratory: {
      all: ['laboratory'],
      byPatient: (rut: string) => ['laboratory', 'patient', rut],
    },
  },
}));

import { useLabViewer } from '@/features/laboratory/hooks/useLabViewer';
import type { LabPatient, SyslabExamItem } from '@/types/domain/labExamTypes';

const PATIENT: LabPatient = {
  bedId: 'R1',
  label: 'R1 · Juan Pérez',
  patientName: 'Juan Pérez',
  rut: '12345678-9',
  clinicalEpisodeId: '141814',
};

const EXAM: SyslabExamItem = {
  id: '43091284',
  link: 'http://10.4.69.90/syslab/detalleexamenes.php?id=43091284',
  date: '06/04/2026',
  time: '13:08:43',
  patientName: 'JUAN PÉREZ',
  origin: 'HOSPITALIZADOS',
  exams: ['HEMOGRAMA'],
};

const createWrapper = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function QueryClientTestWrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
};

describe('useLabViewer episode identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPatientByRut.mockResolvedValue(null);
  });

  it('starts a fresh lookup when the same RUN moves to a different clinical episode', async () => {
    mockSearchSyslabExams.mockResolvedValue({ success: true, data: [EXAM] });
    const { result, rerender } = renderHook(
      ({ clinicalEpisodeId }: { clinicalEpisodeId: string }) =>
        useLabViewer([{ ...PATIENT, clinicalEpisodeId }]),
      {
        initialProps: { clinicalEpisodeId: '141814' },
        wrapper: createWrapper(),
      }
    );

    await act(async () => result.current.search());
    await waitFor(() =>
      expect(mockSearchSyslabExams).toHaveBeenCalledWith('12345678-9', '141814')
    );

    rerender({ clinicalEpisodeId: '141900' });
    await waitFor(() =>
      expect(mockSearchSyslabExams).toHaveBeenCalledWith('12345678-9', '141900')
    );
  });

  it('fails closed when the same RUN has two different active clinical episodes', async () => {
    const patients = [
      { ...PATIENT, clinicalEpisodeId: '141814' },
      { ...PATIENT, bedId: 'R2', clinicalEpisodeId: '141900' },
    ];
    const { result } = renderHook(() => useLabViewer(patients), { wrapper: createWrapper() });

    await act(async () => result.current.search());

    await waitFor(() => expect(result.current.error).toContain('más de un episodio activo'), {
      timeout: 3_000,
    });
    expect(mockSearchSyslabExams).not.toHaveBeenCalled();
  });

  it('does not reuse cached external results after the RUN becomes episode-ambiguous', async () => {
    mockSearchSyslabExams.mockResolvedValue({ success: true, data: [EXAM] });
    const externalPatients: LabPatient[] = [{ ...PATIENT, clinicalEpisodeId: undefined }];
    const ambiguousPatients: LabPatient[] = [
      { ...PATIENT, clinicalEpisodeId: '141814' },
      { ...PATIENT, bedId: 'R2', clinicalEpisodeId: '141900' },
    ];
    const { result, rerender } = renderHook(
      ({ patients }: { patients: LabPatient[] }) => useLabViewer(patients),
      {
        initialProps: { patients: externalPatients },
        wrapper: createWrapper(),
      }
    );

    await act(async () => result.current.search());
    await waitFor(() => expect(result.current.examList).toHaveLength(1));

    rerender({ patients: ambiguousPatients });

    await waitFor(() => expect(result.current.error).toContain('más de un episodio activo'), {
      timeout: 3_000,
    });
    expect(result.current.examList).toHaveLength(0);
    expect(mockSearchSyslabExams).toHaveBeenCalledTimes(1);
  });
});
