import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/config/queryClient';
import { useLabViewerQuery } from '@/features/laboratory/hooks/useLabViewerQuery';
import { resolveLabPatientBirthDateFromPdf } from '@/features/laboratory/services/labPatientPdfMetadataService';
import { getPatientByRut } from '@/services/repositories/PatientMasterRepository';
import type { MasterPatient } from '@/types/domain/patientMaster';
import type { LabPatient, SyslabExamItem } from '@/types/domain/labExamTypes';

vi.mock('@/services/laboratory/syslabService', () => ({ searchSyslabExams: vi.fn() }));
vi.mock('@/services/repositories/PatientMasterRepository', () => ({ getPatientByRut: vi.fn() }));
vi.mock('@/features/laboratory/services/labPatientPdfMetadataService', () => ({
  resolveLabPatientBirthDateFromPdf: vi.fn(),
}));

const patients: LabPatient[] = [];
const master: MasterPatient = {
  rut: '11111111-1',
  fullName: 'Paciente A',
  birthDate: '1980-04-12',
  createdAt: 0,
  updatedAt: 0,
};
const exam = (patientName: string): SyslabExamItem => ({
  id: patientName,
  link: '/report.pdf',
  date: '2026-10-03',
  time: '10:00',
  patientName,
  origin: 'test',
  exams: [],
});
const setup = (withSecondPatient = true) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.laboratory.byPatient(master.rut), {
    success: true,
    data: [exam('Syslab A')],
  });
  if (withSecondPatient)
    client.setQueryData(queryKeys.laboratory.byPatient('22222222-2'), {
      success: true,
      data: [exam('Syslab B')],
    });
  return renderHook(() => useLabViewerQuery({ patients, initialPatientRut: master.rut }), {
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
};

describe('useLabViewerQuery manual patient metadata', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getPatientByRut).mockResolvedValue(null);
    vi.mocked(resolveLabPatientBirthDateFromPdf).mockResolvedValue(undefined);
  });

  it('does not show the previous patient metadata while the next patient loads or has none', async () => {
    let finish!: (value: MasterPatient | null) => void;
    vi.mocked(getPatientByRut)
      .mockResolvedValueOnce(master)
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = resolve;
          })
      );
    const { result } = setup();
    await waitFor(() => expect(result.current.selectedPatient?.patientName).toBe('Paciente A'));
    act(() => result.current.selectPatient('22222222-2'));
    expect(result.current.selectedPatient).toMatchObject({
      rut: '22222222-2',
      patientName: 'Syslab B',
      birthDate: undefined,
    });
    await waitFor(() => expect(getPatientByRut).toHaveBeenCalledTimes(2));
    await act(async () => finish(null));
    expect(result.current.selectedPatient).toMatchObject({
      patientName: 'Syslab B',
      birthDate: undefined,
    });
  });

  it('does not start a fallback PDF lookup after an obsolete repository request fails', async () => {
    let fail!: (error: Error) => void;
    vi.mocked(getPatientByRut).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        })
    );
    const { result } = setup(false);
    await waitFor(() => expect(getPatientByRut).toHaveBeenCalledTimes(1));
    act(() => result.current.setSelectedRut('22222222-2'));
    await act(async () => fail(new Error('unavailable')));
    expect(resolveLabPatientBirthDateFromPdf).not.toHaveBeenCalled();
    expect(result.current.selectedPatient).toBeNull();
  });

  it('ignores a late PDF result after the selected RUT changes', async () => {
    let finish!: (value: string | undefined) => void;
    vi.mocked(resolveLabPatientBirthDateFromPdf).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const { result } = setup();
    await waitFor(() => expect(resolveLabPatientBirthDateFromPdf).toHaveBeenCalledTimes(1));
    act(() => result.current.setSelectedRut('22222222-2'));
    await act(async () => finish('1980-04-12'));
    expect(result.current.selectedPatient).toMatchObject({
      patientName: 'Syslab B',
      birthDate: undefined,
    });
  });
});
