/**
 * @fileoverview Unit tests for the useLabViewer hook.
 * Tests patient deduplication, search flow, PDF viewer, selection, and analysis.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.unmock('@/features/laboratory/hooks/useLabViewer');
vi.unmock('@/features/laboratory/controllers/labFormattingController');
vi.unmock('@/features/laboratory/controllers/labAnalyticsController');
vi.unmock('@/features/laboratory/constants/labConstants');

const mockSearchSyslabExams = vi.fn();
const mockFetchSyslabExamDetails = vi.fn();
const mockFetchSyslabPdfArrayBuffer = vi.fn();
const mockEnrichMicrobiologyDetailsFromPdf = vi.fn();
const mockEnrichUrineRatioDetailsFromPdf = vi.fn();
const mockWriteClipboardText = vi.fn();
const mockGetPatientByRut = vi.fn();
const mockExtractPdfText = vi.fn();

vi.mock('@/services/laboratory/syslabService', () => ({
  searchSyslabExams: (...args: unknown[]) => mockSearchSyslabExams(...args),
  fetchSyslabExamDetails: (...args: unknown[]) => mockFetchSyslabExamDetails(...args),
  fetchSyslabPdfArrayBuffer: (...args: unknown[]) => mockFetchSyslabPdfArrayBuffer(...args),
  buildSyslabPdfUrl: (link: string) =>
    `http://localhost:3000/api/exams/pdf?link=${encodeURIComponent(link)}`,
}));

vi.mock('@/services/utils/loggerScope', async () => {
  const { createLoggerScopeMock } = await import('@/tests/utils/loggerScopeMock');
  return createLoggerScopeMock();
});

vi.mock('@/shared/runtime/browserClipboardRuntime', () => ({
  writeClipboardText: (...args: unknown[]) => mockWriteClipboardText(...args),
}));

vi.mock('@/services/repositories/PatientMasterRepository', () => ({
  getPatientByRut: (...args: unknown[]) => mockGetPatientByRut(...args),
}));

vi.mock('@/features/laboratory/services/labPdfTextSupport', () => ({
  extractPdfText: (...args: unknown[]) => mockExtractPdfText(...args),
  normalizePdfText: (text: string) =>
    text
      .replace(/\u00a2/g, 'ó')
      .replace(/\u00b0/g, 'o')
      .replace(/[ \t]+/g, ' ')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
}));

vi.mock('@/features/laboratory/controllers/labSummaryController', async importOriginal => {
  const original =
    await importOriginal<typeof import('@/features/laboratory/controllers/labSummaryController')>();
  return {
    ...original,
    buildLabSummaryText: vi.fn(() => 'Laboratorio (06/04/2026 13:08): Hb 14'),
  };
});

vi.mock('@/features/laboratory/services/labFirestoreService', () => ({
  saveLabResults: vi.fn(),
  getLabResults: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/features/laboratory/services/labMicrobiologyPdfService', () => ({
  enrichMicrobiologyDetailsFromPdf: (...args: unknown[]) =>
    mockEnrichMicrobiologyDetailsFromPdf(...args),
}));

vi.mock('@/features/laboratory/services/labUrinePdfService', () => ({
  enrichUrineRatioDetailsFromPdf: (...args: unknown[]) =>
    mockEnrichUrineRatioDetailsFromPdf(...args),
}));

vi.mock('@/config/queryClient', () => ({
  queryKeys: {
    laboratory: {
      all: ['laboratory'],
      byPatient: (rut: string) => ['laboratory', 'patient', rut],
    },
  },
}));

const createWrapper = () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function QueryClientTestWrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
};

import { useLabViewer } from '@/features/laboratory/hooks/useLabViewer';
import type { LabPatient, SyslabExamDetail, SyslabExamItem } from '@/types/domain/labExamTypes';
import type { LabTrendGroup } from '@/types/domain/labAnalyticsTypes';

/* ------------------------------------------------------------------ */
/*  Test data                                                          */
/* ------------------------------------------------------------------ */

const PATIENTS: LabPatient[] = [
  {
    bedId: 'R1',
    label: 'R1 · Juan Pérez',
    patientName: 'Juan Pérez',
    rut: '12345678-9',
    clinicalEpisodeId: '141814',
    birthDate: '1980-04-12',
    diagnosis: 'Neumonía',
  },
  {
    bedId: 'R2',
    label: 'R2 · María López',
    patientName: 'María López',
    rut: '98765432-1',
    birthDate: '1979-11-02',
    diagnosis: 'Fractura',
  },
  {
    bedId: 'R3',
    label: 'R3 · Juan Pérez',
    patientName: 'Juan Pérez',
    rut: '12345678-9',
    clinicalEpisodeId: '141814',
    birthDate: '1980-04-12',
    diagnosis: 'Neumonía',
  },
];

const MOCK_EXAM: SyslabExamItem = {
  id: '43091284',
  link: 'http://10.4.69.90/syslab/detalleexamenes.php?id=43091284',
  date: '06/04/2026',
  time: '13:08:43',
  patientName: 'JUAN PÉREZ',
  origin: 'HOSPITALIZADOS',
  exams: ['HEMOGRAMA', 'GLICEMIA'],
};

const MOCK_EXAM_2: SyslabExamItem = {
  id: '43090001',
  link: 'http://10.4.69.90/syslab/detalleexamenes.php?id=43090001',
  date: '01/03/2026',
  time: '09:00:00',
  patientName: 'JUAN PÉREZ',
  origin: 'HOSPITALIZADOS',
  exams: ['HEMOGRAMA'],
};

/* ================================================================== */
/*  Hook behavior                                                      */
/* ================================================================== */

describe('useLabViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnrichMicrobiologyDetailsFromPdf.mockImplementation(
      async (details: SyslabExamDetail[]) => details
    );
    mockEnrichUrineRatioDetailsFromPdf.mockImplementation(
      async (details: SyslabExamDetail[]) => details
    );
    mockWriteClipboardText.mockResolvedValue(undefined);
    mockGetPatientByRut.mockResolvedValue(null);
    mockFetchSyslabPdfArrayBuffer.mockResolvedValue(new ArrayBuffer(0));
    mockExtractPdfText.mockResolvedValue('');
  });

  it('deduplicates patients by RUT', () => {
    const { result } = renderHook(() => useLabViewer(PATIENTS), { wrapper: createWrapper() });
    expect(result.current.uniquePatients).toHaveLength(2);
  });

  it('exposes the selected patient metadata', () => {
    const { result } = renderHook(() => useLabViewer(PATIENTS), { wrapper: createWrapper() });
    expect(result.current.selectedPatient).toEqual(
      expect.objectContaining({
        rut: '12345678-9',
        birthDate: '1980-04-12',
      })
    );
  });

  it('selects first patient by default', () => {
    const { result } = renderHook(() => useLabViewer(PATIENTS), { wrapper: createWrapper() });
    expect(result.current.selectedRut).toBe('12345678-9');
  });

  it('search populates examList on success', async () => {
    mockSearchSyslabExams.mockResolvedValue({ success: true, data: [MOCK_EXAM] });
    const { result } = renderHook(() => useLabViewer(PATIENTS), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.search();
    });
    await waitFor(() => expect(result.current.examList).toHaveLength(1));
    expect(mockSearchSyslabExams).toHaveBeenCalledWith('12345678-9', '141814');
  });

  it('starts a fresh lookup when the same RUN moves to a different clinical episode', async () => {
    mockSearchSyslabExams.mockResolvedValue({ success: true, data: [MOCK_EXAM] });
    const { result, rerender } = renderHook(
      ({ clinicalEpisodeId }: { clinicalEpisodeId: string }) =>
        useLabViewer([
          {
            ...PATIENTS[0],
            clinicalEpisodeId,
          },
        ]),
      {
        initialProps: { clinicalEpisodeId: '141814' },
        wrapper: createWrapper(),
      }
    );

    await act(async () => {
      await result.current.search();
    });
    await waitFor(() =>
      expect(mockSearchSyslabExams).toHaveBeenCalledWith('12345678-9', '141814')
    );

    rerender({ clinicalEpisodeId: '141900' });

    await waitFor(() =>
      expect(mockSearchSyslabExams).toHaveBeenCalledWith('12345678-9', '141900')
    );
  });

  it('fails closed when the same RUN has two different active clinical episodes', async () => {
    const ambiguousPatients = [
      { ...PATIENTS[0], clinicalEpisodeId: '141814' },
      { ...PATIENTS[0], bedId: 'R2', clinicalEpisodeId: '141900' },
    ];
    const { result } = renderHook(
      () => useLabViewer(ambiguousPatients),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      await result.current.search();
    });

    await waitFor(() => expect(result.current.error).toContain('más de un episodio activo'), {
      timeout: 3_000,
    });
    expect(mockSearchSyslabExams).not.toHaveBeenCalled();
  });

  it('hydrates external RUT birth date from the first Syslab PDF when the patient is not in hospital census', async () => {
    mockSearchSyslabExams.mockResolvedValue({
      success: true,
      data: [
        {
          ...MOCK_EXAM,
          patientName: 'PACIENTE EXTERNO',
          origin: 'URGENCIA',
        },
      ],
    });
    mockGetPatientByRut.mockResolvedValue(null);
    mockExtractPdfText.mockResolvedValue(`
      HOSPITAL DE HANGA ROA
      Nombre : PACIENTE EXTERNO
      Rut/Fic: 11.111.111-1
      Fecha de Nacimiento: 12/04/1980
      E X A M E N E S
    `);

    const { result } = renderHook(() => useLabViewer([], '11111111-1'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.search();
    });

    await waitFor(() =>
      expect(result.current.selectedPatient).toEqual(
        expect.objectContaining({
          rut: '11111111-1',
          patientName: 'PACIENTE EXTERNO',
          birthDate: '1980-04-12',
        })
      )
    );
    expect(mockFetchSyslabPdfArrayBuffer).toHaveBeenCalledWith(MOCK_EXAM.link);
  });

  it('search sets error on failure', async () => {
    mockSearchSyslabExams.mockRejectedValue(new Error('Failed'));
    const { result } = renderHook(() => useLabViewer(PATIENTS), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.search();
    });
    await waitFor(() => expect(result.current.error).toBe('Failed'), { timeout: 5000 });
  });

  // Selection
  it('toggleExamSelection adds and removes IDs', () => {
    const { result } = renderHook(() => useLabViewer(PATIENTS), { wrapper: createWrapper() });
    act(() => result.current.toggleExamSelection('43091284'));
    expect(result.current.selectedExamIds.has('43091284')).toBe(true);
    act(() => result.current.toggleExamSelection('43091284'));
    expect(result.current.selectedExamIds.has('43091284')).toBe(false);
  });

  it('selectAllExams toggles all selectable exams', async () => {
    mockSearchSyslabExams.mockResolvedValue({ success: true, data: [MOCK_EXAM, MOCK_EXAM_2] });
    const { result } = renderHook(() => useLabViewer(PATIENTS), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.search();
    });
    await waitFor(() => expect(result.current.examList).toHaveLength(2));

    act(() => result.current.selectAllExams());
    expect(result.current.selectedExamIds.size).toBe(2);

    act(() => result.current.selectAllExams());
    expect(result.current.selectedExamIds.size).toBe(0);
  });

  it('clearSelection empties selectedExamIds', () => {
    const { result } = renderHook(() => useLabViewer(PATIENTS), { wrapper: createWrapper() });
    act(() => result.current.toggleExamSelection('43091284'));
    act(() => result.current.clearSelection());
    expect(result.current.selectedExamIds.size).toBe(0);
  });

  // Analysis
  it('analyzeSelected fetches details and builds analysisData', async () => {
    mockSearchSyslabExams.mockResolvedValue({ success: true, data: [MOCK_EXAM, MOCK_EXAM_2] });
    mockFetchSyslabExamDetails.mockResolvedValue({
      success: true,
      data: [
        {
          url: MOCK_EXAM.link,
          findings: [
            {
              section: 'HEMOGRAMA',
              analysis: 'Hemoglobina',
              result: '14',
              unit: 'g/dL',
              refValue: '12-16',
            },
          ],
        },
        {
          url: MOCK_EXAM_2.link,
          findings: [
            {
              section: 'HEMOGRAMA',
              analysis: 'Hemoglobina',
              result: '13',
              unit: 'g/dL',
              refValue: '12-16',
            },
          ],
        },
      ],
    });

    const { result } = renderHook(() => useLabViewer(PATIENTS), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.search();
    });
    act(() => result.current.toggleExamSelection(MOCK_EXAM.id));
    act(() => result.current.toggleExamSelection(MOCK_EXAM_2.id));

    await act(async () => {
      await result.current.analyzeSelected();
    });

    expect(result.current.analysisData).not.toBeNull();
    const hbGroup = result.current.analysisData!.trendGroups.find(
      (g: LabTrendGroup) => g.variables['Hemoglobina']
    );
    expect(hbGroup).toBeDefined();
    expect(hbGroup!.variables['Hemoglobina']).toHaveLength(2);
    expect(result.current.analysisView).toBe('trends');
  });

  it('closeAnalysis clears analysisData', async () => {
    mockSearchSyslabExams.mockResolvedValue({ success: true, data: [MOCK_EXAM] });
    mockFetchSyslabExamDetails.mockResolvedValue({
      success: true,
      data: [{ url: MOCK_EXAM.link, findings: [] }],
    });

    const { result } = renderHook(() => useLabViewer(PATIENTS), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.search();
    });
    act(() => result.current.toggleExamSelection(MOCK_EXAM.id));
    await act(async () => {
      await result.current.analyzeSelected();
    });

    act(() => result.current.closeAnalysis());
    expect(result.current.analysisData).toBeNull();
  });

  it('copyExamSummary writes the single-exam summary to clipboard', async () => {
    mockFetchSyslabExamDetails.mockResolvedValue({
      success: true,
      data: [
        {
          url: MOCK_EXAM.link,
          findings: [
            {
              section: 'HEMOGRAMA',
              analysis: 'Hemoglobina',
              result: '14',
              unit: 'g/dL',
              refValue: '12-16',
            },
          ],
        },
      ],
    });

    const { result } = renderHook(() => useLabViewer(PATIENTS), { wrapper: createWrapper() });

    await act(async () => {
      const copied = await result.current.copyExamSummary(MOCK_EXAM);
      expect(copied).toBe(true);
    });

    expect(mockFetchSyslabExamDetails).toHaveBeenCalledWith([MOCK_EXAM.link]);
    expect(mockWriteClipboardText).toHaveBeenCalledWith('Laboratorio (06/04/2026 13:08): Hb 14');
  });

  it('setAnalysisView changes active tab', () => {
    const { result } = renderHook(() => useLabViewer(PATIENTS), { wrapper: createWrapper() });
    act(() => result.current.setAnalysisView('trends'));
    expect(result.current.analysisView).toBe('trends');
  });

  // PDF
  it('openPdf / closePdf manages pdfExam', () => {
    const { result } = renderHook(() => useLabViewer(PATIENTS), { wrapper: createWrapper() });
    act(() => result.current.openPdf(MOCK_EXAM));
    expect(result.current.pdfExam).toBe(MOCK_EXAM);
    act(() => result.current.closePdf());
    expect(result.current.pdfExam).toBeNull();
  });

  // Edge cases
  it('selectByDays returns empty set when no exams match', async () => {
    // Load exams with old dates that won't match a 1-day window
    mockSearchSyslabExams.mockResolvedValue({ success: true, data: [MOCK_EXAM_2] });
    const { result } = renderHook(() => useLabViewer(PATIENTS), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.search();
    });
    // MOCK_EXAM_2 date is 01/03/2026 — selecting last 1 day should not match
    act(() => result.current.selectByDays(1));
    expect(result.current.selectedExamIds.size).toBe(0);
  });

  it('hook works with empty patients array', () => {
    const { result } = renderHook(() => useLabViewer([]), { wrapper: createWrapper() });
    expect(result.current.uniquePatients).toHaveLength(0);
    expect(result.current.selectedRut).toBe('');
  });

  it('analyzeSelected does nothing when no exams selected', async () => {
    mockSearchSyslabExams.mockResolvedValue({ success: true, data: [MOCK_EXAM] });
    const { result } = renderHook(() => useLabViewer(PATIENTS), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.search();
    });
    // Don't select anything, then analyze
    await act(async () => {
      await result.current.analyzeSelected();
    });
    // analysisData stays null, fetchSyslabExamDetails never called
    expect(result.current.analysisData).toBeNull();
    expect(mockFetchSyslabExamDetails).not.toHaveBeenCalled();
  });

  // Reset
  it('reset clears all state', async () => {
    mockSearchSyslabExams.mockResolvedValue({ success: true, data: [MOCK_EXAM] });
    const { result } = renderHook(() => useLabViewer(PATIENTS), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.search();
    });
    await waitFor(() => expect(result.current.examList).toHaveLength(1));
    act(() => result.current.toggleExamSelection(MOCK_EXAM.id));

    act(() => result.current.reset());
    // After reset, search is disabled so examList comes from query cache which is empty
    expect(result.current.selectedExamIds.size).toBe(0);
    expect(result.current.analysisData).toBeNull();
  });
});
