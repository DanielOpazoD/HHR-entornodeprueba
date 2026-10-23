import { act, renderHook, waitFor } from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedBedRow } from '@/features/census/types/censusTableTypes';
import { useClinicalDocumentPresenceByBed } from '@/features/census/hooks/useClinicalDocumentPresenceByBed';
import { executeListClinicalDocumentsByEpisodeKeys } from '@/application/clinical-documents/clinicalDocumentUseCases';
import {
  createQueryClientTestWrapper,
  alwaysRefetchDefaults,
} from '@/tests/utils/queryClientTestUtils';
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

  it('keeps confirmed document indicators during a failed refresh and recovers on success', async () => {
    vi.mocked(executeListClinicalDocumentsByEpisodeKeys)
      .mockResolvedValueOnce({
        status: 'success',
        data: [
          {
            status: 'draft',
            episodeKey: '1-9__2026-03-05',
            patientRut: '1-9',
          },
        ] as never,
        issues: [],
      })
      .mockResolvedValueOnce({
        status: 'failed',
        data: [],
        userSafeMessage: 'No se pudo actualizar la presencia documental.',
        issues: [{ kind: 'unknown', message: 'temporary failure' }],
      });
    const { queryClient, wrapper } = createQueryClientTestWrapper();
    const { result } = renderHook(
      () =>
        useClinicalDocumentPresenceByBed({
          unifiedRows,
          currentDateString: '2026-03-05',
          enabled: true,
        }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.byBedId.R1).toBe(true));
    await queryClient.invalidateQueries({ queryKey: ['clinicalDocuments', 'presenceByBed'] });

    expect(executeListClinicalDocumentsByEpisodeKeys).toHaveBeenCalledTimes(2);
    expect(result.current.byBedId.R1).toBe(true);
    expect(warnMock).toHaveBeenCalledWith(
      'Failed to resolve clinical document presence',
      'No se pudo actualizar la presencia documental.'
    );

    await queryClient.invalidateQueries({ queryKey: ['clinicalDocuments', 'presenceByBed'] });
    await waitFor(() => expect(result.current.byBedId.R1).toBe(false));
  });

  it('caches only presence fields and keeps badge data stable when document content changes', async () => {
    const presence = { status: 'draft', episodeKey: '1-9__2026-03-05', patientRut: '1-9' };
    vi.mocked(executeListClinicalDocumentsByEpisodeKeys)
      .mockResolvedValueOnce({
        status: 'success',
        issues: [],
        data: [
          {
            ...presence,
            renderedText: 'Primera versión sintética',
            versionHistory: [{ version: 1 }],
          },
        ] as never,
      })
      .mockResolvedValueOnce({
        status: 'success',
        issues: [],
        data: [
          {
            ...presence,
            renderedText: 'Segunda versión sintética',
            versionHistory: [{ version: 1 }, { version: 2 }],
          },
        ] as never,
      });
    const { wrapper, queryClient } = createQueryClientTestWrapper();
    const { result } = renderHook(
      () =>
        useClinicalDocumentPresenceByBed({
          unifiedRows,
          currentDateString: '2026-03-05',
          enabled: true,
        }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.byBedId.R1).toBe(true));
    const query = queryClient.getQueryCache().getAll()[0];
    const cached = query.state.data;
    const badges = result.current;
    expect(cached).toEqual([presence]);
    await queryClient.invalidateQueries({ queryKey: ['clinicalDocuments', 'presenceByBed'] });
    expect(executeListClinicalDocumentsByEpisodeKeys).toHaveBeenCalledTimes(2);
    expect(query.state.data).toBe(cached);
    expect(result.current).toBe(badges);
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

  it('refreshes the badges every 5 minutes and on tab return only after 2 minutes', async () => {
    vi.useFakeTimers();
    // Worst case: refetch even fresh data on every tab return, so only the
    // query's own options can prevent the extra read.
    const { queryClient, wrapper } = createQueryClientTestWrapper({
      config: { defaultOptions: alwaysRefetchDefaults },
    });
    const reads = () => vi.mocked(executeListClinicalDocumentsByEpisodeKeys).mock.calls.length;
    const returnToTab = () =>
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
    try {
      renderHook(
        () =>
          useClinicalDocumentPresenceByBed({
            unifiedRows,
            currentDateString: '2026-03-05',
            enabled: true,
          }),
        { wrapper }
      );
      await act(async () => vi.advanceTimersByTimeAsync(0));
      expect(reads()).toBe(1);

      await act(async () => vi.advanceTimersByTimeAsync(60_000));
      returnToTab();
      await act(async () => vi.advanceTimersByTimeAsync(0));
      expect(reads()).toBe(1);

      await act(async () => vi.advanceTimersByTimeAsync(4 * 60_000 - 1));
      expect(reads()).toBe(1);
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(reads()).toBe(2);

      await act(async () => vi.advanceTimersByTimeAsync(2 * 60_000 + 1));
      returnToTab();
      await act(async () => vi.advanceTimersByTimeAsync(0));
      expect(reads()).toBe(3);
    } finally {
      focusManager.setFocused(undefined);
      queryClient.clear();
      vi.useRealTimers();
    }
  });
});
