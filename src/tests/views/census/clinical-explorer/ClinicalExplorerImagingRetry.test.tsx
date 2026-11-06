import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useClinicalExplorerImaging } from '@/features/census/components/clinical-explorer/useClinicalExplorerImaging';
import {
  searchMMRADExams,
  searchMMRADCheckDigitExams,
  type MMRADSearchResult,
} from '@/services/radiology/mmradService';
vi.mock('@/services/radiology/mmradService', async original => ({
  ...(await original<typeof import('@/services/radiology/mmradService')>()),
  searchMMRADExams: vi.fn(),
  searchMMRADCheckDigitExams: vi.fn(),
}));
afterEach(() => vi.useRealTimers());
it('waits for the new alternate search after retrying a completed empty search', async () => {
  vi.useFakeTimers();
  const rut = '12.345.678-5';
  const empty: MMRADSearchResult = { rut, examenes: [] };
  let resolveExact!: (value: MMRADSearchResult) => void;
  let resolveAlternate!: (value: MMRADSearchResult) => void;
  vi.mocked(searchMMRADExams)
    .mockResolvedValueOnce(empty)
    .mockReturnValueOnce(
      new Promise(resolve => {
        resolveExact = resolve;
      })
    );
  vi.mocked(searchMMRADCheckDigitExams)
    .mockResolvedValueOnce(empty)
    .mockReturnValueOnce(
      new Promise(resolve => {
        resolveAlternate = resolve;
      })
    );
  const { result } = renderHook(() =>
    useClinicalExplorerImaging({
      rut,
      patientName: 'SINTETICO',
      admissionDate: '2026-10-01',
      enabled: true,
    })
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  expect(result.current.phase).toBe('empty');
  act(() => result.current.retry());
  expect(result.current.phase).toBe('listing');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  await act(async () => resolveExact(empty));
  expect(result.current.phase).toBe('listing');
  await act(async () => resolveAlternate(empty));
  expect(result.current.phase).toBe('empty');
});
