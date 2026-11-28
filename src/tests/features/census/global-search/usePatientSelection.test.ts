import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MasterPatient } from '@/types/domain/patientMaster';
import type { PatientHistoryResult } from '@/features/census/services/patientHistoryService';

const mockGetPatientMovementHistory = vi.fn();
const mockListClinicalDocumentsByEpisode = vi.fn();
const mockGetClinicalDocument = vi.fn();
const mockGenerateClinicalDocumentPdfBlob = vi.fn();

vi.mock('@/features/census/services/patientHistoryService', () => ({
  getPatientMovementHistoryDetailed: (...args: unknown[]) => mockGetPatientMovementHistory(...args),
}));

vi.mock('@/application/ports/clinicalDocumentPort', () => ({
  defaultClinicalDocumentPort: {
    listByEpisode: (...args: unknown[]) => mockListClinicalDocumentsByEpisode(...args),
    get: (...args: unknown[]) => mockGetClinicalDocument(...args),
  },
}));

vi.mock('@/features/clinical-documents', () => ({
  generateClinicalDocumentPdfBlob: (...args: unknown[]) =>
    mockGenerateClinicalDocumentPdfBlob(...args),
}));

import { usePatientSelection } from '@/features/census/components/global-search/usePatientSelection';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';

const basePatient: MasterPatient = {
  rut: '1.000.122-6',
  fullName: 'Isut Rebolesu Litus',
  forecast: 'Fonasa',
  gender: 'Femenino',
  birthDate: '1966-09-03',
  createdAt: 1,
  updatedAt: 1,
  hospitalizations: [
    {
      id: 'ing-1',
      type: 'Ingreso',
      date: '2026-04-07',
      diagnosis: 'ICC',
      bedName: 'H1C1',
    },
  ],
};

describe('usePatientSelection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('stores reconciled grouped episodes when history closes an open hospitalization', async () => {
    const history: PatientHistoryResult = {
      patientName: basePatient.fullName,
      rut: basePatient.rut,
      totalDays: 8,
      firstSeen: '2026-04-07',
      lastSeen: '2026-04-15',
      movements: [
        {
          date: '2026-04-07',
          bedId: 'H1C1',
          bedName: 'H1C1',
          bedType: 'MEDIA',
          type: 'admission',
        },
        {
          date: '2026-04-15',
          bedId: 'H1C1',
          bedName: 'H1C1',
          bedType: 'MEDIA',
          type: 'discharge',
          details: 'Domicilio (Habitual)',
        },
      ],
    };

    mockGetPatientMovementHistory.mockResolvedValue({ history, source: 'server' });

    const { result } = renderHook(() => usePatientSelection());

    await act(async () => {
      await result.current.selectPatient(basePatient);
    });

    await waitFor(() =>
      expect(result.current.selectedPatient?.timelineState.groupedEpisodes[0].discharge?.date).toBe(
        '2026-04-15'
      )
    );

    expect(result.current.selectedPatient?.timelineState.episodeCount).toBe(1);
    expect(result.current.selectedPatient?.isLoadingHistory).toBe(false);
    expect(mockGetPatientMovementHistory).toHaveBeenCalledWith(
      basePatient.rut,
      expect.objectContaining({ forceFullRemoteHydration: true })
    );
  });

  it('reuses an in-flight history lookup when the same patient is selected twice', async () => {
    let resolveHistory: (history: PatientHistoryResult) => void = () => undefined;
    const historyPromise = new Promise<PatientHistoryResult>(resolve => {
      resolveHistory = resolve;
    });
    const history: PatientHistoryResult = {
      patientName: basePatient.fullName,
      rut: basePatient.rut,
      totalDays: 8,
      firstSeen: '2026-04-07',
      lastSeen: '2026-04-15',
      movements: [
        {
          date: '2026-04-07',
          bedId: 'H1C1',
          bedName: 'H1C1',
          bedType: 'MEDIA',
          type: 'admission',
        },
        {
          date: '2026-04-15',
          bedId: 'H1C1',
          bedName: 'H1C1',
          bedType: 'MEDIA',
          type: 'discharge',
          details: 'Domicilio (Habitual)',
        },
      ],
    };

    mockGetPatientMovementHistory.mockReturnValue(
      historyPromise.then(history => ({ history, source: 'server' }))
    );

    const { result } = renderHook(() => usePatientSelection());

    await act(async () => {
      void result.current.selectPatient(basePatient);
      void result.current.selectPatient(basePatient);
    });

    expect(mockGetPatientMovementHistory).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveHistory(history);
      await historyPromise;
    });

    await waitFor(() => expect(result.current.selectedPatient?.timelineState.episodeCount).toBe(1));
    expect(result.current.selectedPatient?.isLoadingHistory).toBe(false);
  });

  it('finds clinical documents when the search episode date is one day before the clinical document key', async () => {
    mockListClinicalDocumentsByEpisode.mockImplementation(async (episodeKey: string) =>
      episodeKey === '10.000.117-9__2026-04-16'
        ? [
            {
              id: 'doc-epicrisis-1',
              admissionDate: '2026-04-15',
              documentType: 'epicrisis',
              status: 'draft',
              audit: {
                createdAt: '2026-04-22T10:00:00.000Z',
                updatedAt: '2026-04-22T10:30:00.000Z',
                createdBy: { displayName: 'Degaro' },
              },
            },
          ]
        : []
    );

    const { result } = renderHook(() => usePatientSelection());

    act(() => {
      result.current.loadEpisodeDocuments('10.000.117-9__2026-04-15');
    });

    await waitFor(() =>
      expect(result.current.episodeDocuments['10.000.117-9__2026-04-15']?.docs).toHaveLength(1)
    );

    expect(mockListClinicalDocumentsByEpisode).toHaveBeenCalledWith('10.000.117-9__2026-04-16');
    expect(result.current.episodeDocuments['10.000.117-9__2026-04-15']?.docs[0]).toMatchObject({
      id: 'doc-epicrisis-1',
      episodeKey: '10.000.117-9__2026-04-16',
      documentType: 'epicrisis',
      status: 'draft',
      createdBy: 'Degaro',
    });
  });
  it('keeps an adjacent readmission document in its own stay', async () => {
    const first = '1-9__2025-01-01';
    const next = '1-9__2025-01-02';
    mockGetPatientMovementHistory.mockResolvedValue({ history: null, source: 'server' });
    mockListClinicalDocumentsByEpisode.mockImplementation(async key =>
      key === next ? [{ id: 'second-stay', episodeKey: next, admissionDate: '2025-01-02' }] : []
    );
    const { result } = renderHook(() => usePatientSelection());
    await act(async () => {
      await result.current.selectPatient({
        ...basePatient,
        rut: '1-9',
        hospitalizations: [
          { id: 'first', type: 'Ingreso', date: '2025-01-01', diagnosis: '' },
          { id: 'out', type: 'Egreso', date: '2025-01-01', diagnosis: '' },
          { id: 'second', type: 'Ingreso', date: '2025-01-02', diagnosis: '' },
        ],
      });
    });
    await act(async () => {
      await result.current.loadEpisodeDocuments(first);
    });
    expect(result.current.episodeDocuments[first]?.docs).toEqual([]);
    await act(async () => {
      await result.current.loadEpisodeDocuments(next);
    });
    expect(result.current.episodeDocuments[next]?.docs.map(doc => doc.id)).toEqual(['second-stay']);
  });

  it('reports a failed document read as a failure, never as an episode without documents', async () => {
    mockListClinicalDocumentsByEpisode.mockRejectedValueOnce(new Error('synthetic read failure'));
    const { result } = renderHook(() => usePatientSelection());
    const key = '10.000.117-9__2026-04-15';

    act(() => {
      result.current.loadEpisodeDocuments(key);
    });
    await waitFor(() => expect(result.current.episodeDocuments[key]?.isLoading).toBe(false));
    expect(result.current.episodeDocuments[key]).toMatchObject({ docs: [], loadFailed: true });

    mockListClinicalDocumentsByEpisode.mockResolvedValue([]);
    act(() => {
      result.current.loadEpisodeDocuments(key);
    });
    await waitFor(() =>
      expect(result.current.episodeDocuments[key]).toEqual({
        episodeKey: key,
        docs: [],
        isLoading: false,
      })
    );
  });
  it('retries partial history instead of caching it as a complete lookup', async () => {
    mockGetPatientMovementHistory
      .mockResolvedValueOnce({ history: null, source: 'local' })
      .mockResolvedValueOnce({ history: null, source: 'server' });
    const { result } = renderHook(() => usePatientSelection());
    await act(async () => {
      await result.current.selectPatient(basePatient);
    });
    expect(result.current.selectedPatient?.historyWarning).toMatch(/Historial parcial/);
    await act(async () => {
      await result.current.selectPatient(basePatient);
    });
    expect(mockGetPatientMovementHistory).toHaveBeenCalledTimes(2);
    expect(result.current.selectedPatient?.historyWarning).toBeNull();
    await act(async () => {
      await result.current.selectPatient(basePatient);
    });
    expect(mockGetPatientMovementHistory).toHaveBeenCalledTimes(2);
  });

  it('exposes failed history reads and allows another selection to retry', async () => {
    mockGetPatientMovementHistory
      .mockRejectedValueOnce(new Error('read failure'))
      .mockResolvedValueOnce({ history: null, source: 'server' });
    const { result } = renderHook(() => usePatientSelection());
    await act(async () => {
      await result.current.selectPatient(basePatient);
    });
    expect(result.current.selectedPatient?.historyWarning).toMatch(/No se pudo cargar/);
    await act(async () => {
      await result.current.selectPatient(basePatient);
    });
    expect(mockGetPatientMovementHistory).toHaveBeenCalledTimes(2);
    expect(result.current.selectedPatient?.historyWarning).toBeNull();
  });

  it('revokes generated PDF object URLs immediately if popup is blocked and after delay when opened', async () => {
    vi.useFakeTimers();
    const createUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:pdf-blocked')
      .mockReturnValueOnce('blob:pdf-opened');
    const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const openSpy = vi
      .spyOn(defaultBrowserWindowRuntime, 'open')
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({} as Window);

    mockGetClinicalDocument.mockResolvedValue({ id: 'doc-1' });
    mockGenerateClinicalDocumentPdfBlob.mockResolvedValue(
      new Blob(['%PDF'], { type: 'application/pdf' })
    );

    try {
      const { result } = renderHook(() => usePatientSelection());

      await act(async () => {
        await result.current.downloadDocumentPdf('doc-1', 'epicrisis');
      });
      expect(revokeUrlSpy).toHaveBeenCalledWith('blob:pdf-blocked');

      await act(async () => {
        await result.current.downloadDocumentPdf('doc-1', 'epicrisis');
      });
      expect(revokeUrlSpy).not.toHaveBeenCalledWith('blob:pdf-opened');

      await vi.advanceTimersByTimeAsync(60_000);
      expect(revokeUrlSpy).toHaveBeenCalledWith('blob:pdf-opened');
    } finally {
      vi.useRealTimers();
      createUrlSpy.mockRestore();
      revokeUrlSpy.mockRestore();
      openSpy.mockRestore();
    }
  });
});
