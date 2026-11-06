import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './labAnalyticsController.testSupport';

const mocks = vi.hoisted(() => ({ search: vi.fn(), details: vi.fn() }));

vi.mock('@/services/laboratory/syslabService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/laboratory/syslabService')>();
  return {
    ...actual,
    searchSyslabExams: (...args: unknown[]) => mocks.search(...args),
    fetchSyslabExamDetails: (...args: unknown[]) => mocks.details(...args),
  };
});
vi.mock('@/features/laboratory/hooks/useSyslabAccess', () => ({
  useSyslabAccess: () => ({
    state: 'connected',
    message: 'Sesión de Syslab activa.',
    isOpening: false,
    isAwaitingLogin: false,
    refresh: vi.fn(),
    openLogin: vi.fn(),
  }),
}));

import { useSyslabHospitalizationReports } from '@/features/laboratory/hospitalization-reports';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import { buildDetail, buildExam, buildFinding } from './labAnalyticsController.testSupport';

const older = buildExam({ id: '1', link: 'syslab://exam/1', date: '03/11/2026', time: '07:40:00' });
const newer = buildExam({ id: '2', link: 'syslab://exam/2', date: '06/11/2026', time: '09:00:00' });
const detailsFor = (links: string[]) => ({
  success: true,
  data: links.map(url =>
    buildDetail({
      url,
      findings: [buildFinding({ section: 'BIOQUIMICA', analysis: 'Creatinina', result: '1,1' })],
    })
  ),
});

describe('useSyslabHospitalizationReports', () => {
  beforeEach(() => {
    mocks.search.mockReset();
    mocks.details.mockReset();
    mocks.details.mockImplementation((links: string[]) => Promise.resolve(detailsFor(links)));
  });
  afterEach(() => act(() => setSessionGeneration(null)));

  it('says while a cached read is renewed, so a download does not take the old reports', async () => {
    mocks.search.mockResolvedValueOnce({ success: true, data: [older] });
    let renew: (value: unknown) => void = () => undefined;
    mocks.search.mockReturnValueOnce(new Promise(resolve => (renew = resolve)));
    const { wrapper, queryClient } = createQueryClientTestWrapper();
    const { result } = renderHook(
      () =>
        useSyslabHospitalizationReports({
          rut: '12.345.678-5',
          episodeId: 'ep-1',
          admissionDate: '2026-11-01',
          enabled: true,
        }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.refreshing).toBe(false);

    // The list ages past its reuse window and is asked again.
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: ['laboratory', 'hospitalization'] });
    });
    expect(result.current.phase).toBe('ready');
    expect(result.current.exams.map(exam => exam.id)).toEqual(['1']);
    expect(result.current.refreshing).toBe(true);

    await act(async () => renew({ success: true, data: [older, newer] }));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.phase).toBe('ready');
    expect(result.current.exams.map(exam => exam.id)).toEqual(['1', '2']);
  });
});
