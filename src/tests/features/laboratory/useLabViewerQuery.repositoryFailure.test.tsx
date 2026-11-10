import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDoc } from 'firebase/firestore';
import { queryKeys } from '@/config/queryClient';
import { useLabViewerQuery } from '@/features/laboratory/hooks/useLabViewerQuery';
import { resolveLabPatientBirthDateFromPdf } from '@/features/laboratory/services/labPatientPdfMetadataService';
import type { LabPatient, SyslabExamItem } from '@/types/domain/labExamTypes';

vi.mock('@/firebaseConfig', () => ({ db: {} }));
vi.mock('firebase/firestore', async original => ({
  ...(await original<typeof import('firebase/firestore')>()),
  doc: vi.fn(() => ({ id: 'synthetic-ref' })),
  getDoc: vi.fn(),
}));
vi.mock('@/services/laboratory/syslabService', () => ({ searchSyslabExams: vi.fn() }));
vi.mock('@/features/laboratory/services/labPatientPdfMetadataService', () => ({
  resolveLabPatientBirthDateFromPdf: vi.fn(),
}));

const patients: LabPatient[] = [];
const rut = '11.111.111-1';
const exams: SyslabExamItem[] = [
  {
    id: 'synthetic-exam',
    link: '/synthetic.pdf',
    date: '2026-10-03',
    time: '10:00',
    patientName: 'Paciente sintético PDF',
    origin: 'test',
    exams: [],
  },
];

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.laboratory.byPatient(rut), { success: true, data: exams });
  return renderHook(() => useLabViewerQuery({ patients, initialPatientRut: rut }), {
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
};

describe('laboratory metadata composed with the real patient repository', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveLabPatientBirthDateFromPdf).mockResolvedValue('1980-04-12');
  });

  it('silently enriches from PDF when the SDK index read fails', async () => {
    vi.mocked(getDoc).mockRejectedValueOnce(new Error('synthetic unavailable'));
    const { result } = setup();
    await waitFor(() =>
      expect(result.current.selectedPatient).toMatchObject({
        rut,
        patientName: 'Paciente sintético PDF',
        birthDate: '1980-04-12',
      })
    );
    expect(resolveLabPatientBirthDateFromPdf).toHaveBeenCalledWith(exams);
    expect(result.current.error).toBeNull();
    expect(result.current.examList).toEqual(exams);
  });

  it('keeps PDF enrichment for a confirmed missing index entry', async () => {
    vi.mocked(getDoc).mockResolvedValueOnce({ exists: () => false } as never);
    const { result } = setup();
    await waitFor(() => expect(result.current.selectedPatient?.birthDate).toBe('1980-04-12'));
    expect(result.current.error).toBeNull();
  });
});
