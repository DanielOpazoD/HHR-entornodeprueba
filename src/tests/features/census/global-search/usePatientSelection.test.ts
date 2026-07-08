import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MasterPatient } from '@/types/domain/patientMaster';
import type { PatientHistoryResult } from '@/services/patient/patientHistoryService';

const mockGetPatientMovementHistory = vi.fn();
const mockListClinicalDocumentsByEpisode = vi.fn();

vi.mock('@/services/patient/patientHistoryService', () => ({
  getPatientMovementHistory: (...args: unknown[]) => mockGetPatientMovementHistory(...args),
}));

vi.mock('@/services/repositories/ClinicalDocumentRepository', () => ({
  ClinicalDocumentRepository: {
    listByEpisode: (...args: unknown[]) => mockListClinicalDocumentsByEpisode(...args),
    get: vi.fn(),
  },
}));

import { usePatientSelection } from '@/features/census/components/global-search/usePatientSelection';

const basePatient: MasterPatient = {
  rut: '8.932.066-6',
  fullName: 'Ines Riroroko Leiva',
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
    vi.clearAllMocks();
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

    mockGetPatientMovementHistory.mockResolvedValue(history);

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

    mockGetPatientMovementHistory.mockReturnValue(historyPromise);

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
      episodeKey === '13.545.665-9__2026-04-16'
        ? [
            {
              id: 'doc-epicrisis-1',
              documentType: 'epicrisis',
              status: 'draft',
              audit: {
                createdAt: '2026-04-22T10:00:00.000Z',
                updatedAt: '2026-04-22T10:30:00.000Z',
                createdBy: { displayName: 'Daniel' },
              },
            },
          ]
        : []
    );

    const { result } = renderHook(() => usePatientSelection());

    act(() => {
      result.current.loadEpisodeDocuments('13.545.665-9__2026-04-15');
    });

    await waitFor(() =>
      expect(result.current.episodeDocuments['13.545.665-9__2026-04-15']?.docs).toHaveLength(1)
    );

    expect(mockListClinicalDocumentsByEpisode).toHaveBeenCalledWith('13.545.665-9__2026-04-16');
    expect(result.current.episodeDocuments['13.545.665-9__2026-04-15']?.docs[0]).toMatchObject({
      id: 'doc-epicrisis-1',
      episodeKey: '13.545.665-9__2026-04-16',
      documentType: 'epicrisis',
      status: 'draft',
      createdBy: 'Daniel',
    });
  });
});
