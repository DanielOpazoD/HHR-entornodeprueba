import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useClinicalDocumentPresenceByBed } from '@/features/census/hooks/useClinicalDocumentPresenceByBed';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import type { UnifiedBedRow } from '@/features/census/types/censusTableTypes';
import { BedType } from '@/types/domain/beds';

afterEach(() => vi.doUnmock('@/application/clinical-documents/clinicalDocumentUseCases'));

it('retries the module import on the next query after a transient import failure', async () => {
  vi.doMock('@/application/clinical-documents/clinicalDocumentUseCases', () => {
    throw new Error('Failed to fetch dynamically imported module');
  });
  const { wrapper, queryClient } = createQueryClientTestWrapper();
  const unifiedRows = [
    {
      kind: 'occupied',
      id: 'row-r1',
      isSubRow: false,
      bed: { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false },
      data: { patientName: 'Paciente', rut: '1-9', admissionDate: '2026-03-05' },
    },
  ] as UnifiedBedRow[];
  const { result } = renderHook(
    () =>
      useClinicalDocumentPresenceByBed({
        unifiedRows,
        currentDateString: '2026-03-05',
        enabled: true,
      }),
    { wrapper }
  );
  await waitFor(() => expect(queryClient.getQueryCache().getAll()[0].state.status).toBe('error'));

  vi.doMock('@/application/clinical-documents/clinicalDocumentUseCases', () => ({
    executeListClinicalDocumentsByEpisodeKeys: vi.fn().mockResolvedValue({
      status: 'success',
      issues: [],
      data: [{ status: 'draft', episodeKey: '1-9__2026-03-05', patientRut: '1-9' }],
    }),
  }));
  await queryClient.invalidateQueries({ queryKey: ['clinicalDocuments', 'presenceByBed'] });
  await waitFor(() =>
    expect(result.current.infoByBedId.R1).toEqual({
      present: true,
      totalCount: 1,
      draftCount: 1,
    })
  );
});
