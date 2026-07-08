import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedBedRow } from '@/features/census/types/censusTableTypes';
import { useClinicalDocumentPresenceByBed } from '@/features/census/hooks/useClinicalDocumentPresenceByBed';
import { executeListClinicalDocumentsByEpisodeKeys } from '@/application/clinical-documents/clinicalDocumentUseCases';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import { BedType } from '@/types/domain/beds';

const warnMock = vi.hoisted(() => vi.fn());

vi.mock('@/application/clinical-documents/clinicalDocumentUseCases', () => ({
  executeListClinicalDocumentsByEpisodeKeys: vi.fn(),
}));

vi.mock('@/services/utils/loggerService', () => ({
  logger: {
    child: () => ({
      warn: warnMock,
    }),
  },
}));

describe('useClinicalDocumentPresenceByBed', () => {
  const unifiedRows: UnifiedBedRow[] = [
    {
      kind: 'occupied',
      id: 'row-r1',
      bed: { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false },
      data: {
        patientName: 'Paciente',
        rut: '1-9',
        admissionDate: '2026-03-05',
      },
      isSubRow: false,
    } as UnifiedBedRow,
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeListClinicalDocumentsByEpisodeKeys).mockResolvedValue({
      status: 'success',
      data: [],
      issues: [],
    });
  });

  it('does not query clinical documents when disabled', () => {
    const { wrapper } = createQueryClientTestWrapper();
    const { result } = renderHook(
      () =>
        useClinicalDocumentPresenceByBed({
          unifiedRows,
          currentDateString: '2026-03-05',
          enabled: false,
        }),
      { wrapper }
    );

    expect(result.current).toEqual({
      byBedId: {},
      infoByBedId: {},
    });
    expect(executeListClinicalDocumentsByEpisodeKeys).not.toHaveBeenCalled();
  });

  it('returns empty fallback when the query fails', async () => {
    vi.mocked(executeListClinicalDocumentsByEpisodeKeys).mockRejectedValueOnce(new Error('denied'));
    const { wrapper } = createQueryClientTestWrapper();

    const { result } = renderHook(
      () =>
        useClinicalDocumentPresenceByBed({
          unifiedRows,
          currentDateString: '2026-03-05',
          enabled: true,
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(executeListClinicalDocumentsByEpisodeKeys).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(result.current).toEqual({
        byBedId: { R1: false },
        infoByBedId: {
          R1: { present: false, totalCount: 0, draftCount: 0 },
        },
      });
    });

    expect(warnMock).toHaveBeenCalled();
  });

  it('does not mark a bed as having documents when the returned document rut belongs to another patient', async () => {
    vi.mocked(executeListClinicalDocumentsByEpisodeKeys).mockResolvedValueOnce({
      status: 'success',
      data: [
        {
          status: 'draft',
          episodeKey: '1-9__2026-03-05',
          patientRut: '17.444.506-0',
        },
      ] as never,
      issues: [],
    });
    const { wrapper } = createQueryClientTestWrapper();

    const { result } = renderHook(
      () =>
        useClinicalDocumentPresenceByBed({
          unifiedRows,
          currentDateString: '2026-03-05',
          enabled: true,
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current).toEqual({
        byBedId: { R1: false },
        infoByBedId: {
          R1: { present: false, totalCount: 0, draftCount: 0 },
        },
      });
    });
  });

  it('marks a bed as having documents when the returned document rut matches the current patient', async () => {
    vi.mocked(executeListClinicalDocumentsByEpisodeKeys).mockResolvedValueOnce({
      status: 'success',
      data: [
        {
          status: 'draft',
          episodeKey: '1-9__2026-03-05',
          patientRut: '1-9',
        },
      ] as never,
      issues: [],
    });
    const { wrapper } = createQueryClientTestWrapper();

    const { result } = renderHook(
      () =>
        useClinicalDocumentPresenceByBed({
          unifiedRows,
          currentDateString: '2026-03-05',
          enabled: true,
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current).toEqual({
        byBedId: { R1: true },
        infoByBedId: {
          R1: { present: true, totalCount: 1, draftCount: 1 },
        },
      });
    });
  });

  it('prefers userSafeMessage when the presence listing fails with a typed outcome', async () => {
    vi.mocked(executeListClinicalDocumentsByEpisodeKeys).mockResolvedValueOnce({
      status: 'failed',
      data: [],
      userSafeMessage: 'La presencia documental no está disponible temporalmente.',
      issues: [{ kind: 'unknown', message: 'raw failure' }],
    });
    const { wrapper } = createQueryClientTestWrapper();

    renderHook(
      () =>
        useClinicalDocumentPresenceByBed({
          unifiedRows,
          currentDateString: '2026-03-05',
          enabled: true,
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(warnMock).toHaveBeenCalledWith(
        'Failed to resolve clinical document presence',
        'La presencia documental no está disponible temporalmente.'
      );
    });
  });
});
