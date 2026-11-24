import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './labAnalyticsController.testSupport';

const mocks = vi.hoisted(() => ({ search: vi.fn(), details: vi.fn(), access: vi.fn() }));

vi.mock('@/services/laboratory/syslabService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/laboratory/syslabService')>();
  return {
    ...actual,
    searchSyslabExams: (...args: unknown[]) => mocks.search(...args),
    fetchSyslabExamDetails: (...args: unknown[]) => mocks.details(...args),
  };
});
vi.mock('@/features/laboratory/hooks/useSyslabAccess', () => ({
  useSyslabAccess: () => mocks.access(),
}));

import { settleLabRead } from '@/features/census/components/clinical-explorer/clinicalExplorerLabDownloadModel';
import { useSyslabHospitalizationReports } from '@/features/laboratory/hospitalization-reports';
import { setSessionGeneration } from '@/services/session/sessionStorageTransition';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import { buildDetail, buildExam, buildFinding } from './labAnalyticsController.testSupport';

const connectedAccess = {
  state: 'connected' as const,
  message: 'Sesión de Syslab activa.',
  isOpening: false,
  isAwaitingLogin: false,
  refresh: vi.fn(),
  openLogin: vi.fn(),
};

const accessWith = (
  state: 'checking' | 'connected' | 'login-required' | 'unavailable',
  message = ''
) => ({
  ...connectedAccess,
  state,
  message,
});

const defaultParams = {
  rut: '12.345.678-5',
  episodeId: 'ep-1',
  admissionDate: '2026-11-01',
  enabled: true,
};

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
    mocks.access.mockReset();
    mocks.access.mockReturnValue(connectedAccess);
    mocks.details.mockImplementation((links: string[]) => Promise.resolve(detailsFor(links)));
  });
  afterEach(() => act(() => setSessionGeneration(null)));

  it('says while a cached read is renewed, so a download does not take the old reports', async () => {
    mocks.search.mockResolvedValueOnce({ success: true, data: [older] });
    let renew: (value: unknown) => void = () => undefined;
    mocks.search.mockReturnValueOnce(new Promise(resolve => (renew = resolve)));
    const { wrapper, queryClient } = createQueryClientTestWrapper();
    const { result } = renderHook(() => useSyslabHospitalizationReports(defaultParams), {
      wrapper,
    });
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

  it('shows cached reports while Syslab access is checking, yet holds downloads with refreshing=true', async () => {
    mocks.search.mockResolvedValueOnce({ success: true, data: [older] });
    const { wrapper } = createQueryClientTestWrapper();
    const first = renderHook(() => useSyslabHospitalizationReports(defaultParams), { wrapper });
    await waitFor(() => expect(first.result.current.phase).toBe('ready'));
    first.unmount();

    mocks.access.mockReturnValue(accessWith('checking', 'Comprobando la sesión de Syslab…'));
    const remount = renderHook(() => useSyslabHospitalizationReports(defaultParams), { wrapper });
    expect(remount.result.current.phase).toBe('ready');
    expect(remount.result.current.exams.map(exam => exam.id)).toEqual(['1']);
    expect(remount.result.current.analysis).not.toBeNull();
    expect(remount.result.current.refreshing).toBe(true);
    expect(settleLabRead(remount.result.current)).toBeNull();

    mocks.access.mockReturnValue(connectedAccess);
    remount.rerender();
    expect(remount.result.current.phase).toBe('ready');
    expect(remount.result.current.refreshing).toBe(false);
    expect(settleLabRead(remount.result.current)).toMatchObject({ kind: 'ready' });
  });

  it('holds a download across checking -> connected while a stale cached list is renewed', async () => {
    mocks.search.mockResolvedValueOnce({ success: true, data: [older] });
    let renew: (value: unknown) => void = () => undefined;
    mocks.search.mockReturnValueOnce(new Promise(resolve => (renew = resolve)));
    const { wrapper, queryClient } = createQueryClientTestWrapper();
    const first = renderHook(() => useSyslabHospitalizationReports(defaultParams), { wrapper });
    await waitFor(() => expect(first.result.current.phase).toBe('ready'));
    first.unmount();

    // The list ages past its reuse window while nobody is observing it.
    await act(async () => {
      await queryClient.invalidateQueries({
        predicate: query => query.queryKey.includes('exams'),
        refetchType: 'none',
      });
    });

    mocks.access.mockReturnValue(accessWith('checking', 'Comprobando la sesión de Syslab…'));
    const remount = renderHook(() => useSyslabHospitalizationReports(defaultParams), { wrapper });
    expect(remount.result.current.phase).toBe('ready');
    expect(remount.result.current.refreshing).toBe(true);
    expect(settleLabRead(remount.result.current)).toBeNull();
    expect(mocks.search).toHaveBeenCalledTimes(1);

    mocks.access.mockReturnValue(connectedAccess);
    remount.rerender();
    expect(remount.result.current.refreshing).toBe(true);
    expect(settleLabRead(remount.result.current)).toBeNull();
    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(2));

    await act(async () => renew({ success: true, data: [older, newer] }));
    await waitFor(() =>
      expect(settleLabRead(remount.result.current)).toMatchObject({ kind: 'ready' })
    );
    expect(remount.result.current.exams.map(exam => exam.id)).toEqual(['1', '2']);
  });

  it('keeps checking phase when no cached answer exists yet', () => {
    mocks.access.mockReturnValue(accessWith('checking', 'Comprobando la sesión de Syslab…'));
    const { wrapper } = createQueryClientTestWrapper();
    const { result } = renderHook(() => useSyslabHospitalizationReports(defaultParams), {
      wrapper,
    });
    expect(result.current.phase).toBe('checking');
    expect(result.current.refreshing).toBe(false);
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.details).not.toHaveBeenCalled();
  });

  it('does not fetch details prematurely while access is checking when only the list is cached', async () => {
    mocks.search.mockResolvedValueOnce({ success: true, data: [older] });
    mocks.details.mockReturnValueOnce(new Promise(() => undefined));
    const { wrapper } = createQueryClientTestWrapper();
    const first = renderHook(() => useSyslabHospitalizationReports(defaultParams), { wrapper });
    await waitFor(() => expect(first.result.current.phase).toBe('reading'));
    first.unmount();

    mocks.details.mockClear();
    mocks.access.mockReturnValue(accessWith('checking', 'Comprobando la sesión de Syslab…'));
    const remount = renderHook(() => useSyslabHospitalizationReports(defaultParams), { wrapper });
    expect(remount.result.current.phase).toBe('checking');
    expect(remount.result.current.refreshing).toBe(false);
    expect(mocks.details).not.toHaveBeenCalled();
  });

  it('hides cached reports if Syslab access resolves to login-required or unavailable', async () => {
    mocks.search.mockResolvedValueOnce({ success: true, data: [older] });
    const { wrapper } = createQueryClientTestWrapper();
    const first = renderHook(() => useSyslabHospitalizationReports(defaultParams), { wrapper });
    await waitFor(() => expect(first.result.current.phase).toBe('ready'));
    first.unmount();

    mocks.access.mockReturnValue(accessWith('checking', 'Comprobando…'));
    const remount = renderHook(() => useSyslabHospitalizationReports(defaultParams), { wrapper });
    expect(remount.result.current.phase).toBe('ready');

    mocks.access.mockReturnValue(accessWith('login-required', 'Syslab requiere iniciar sesión.'));
    remount.rerender();
    expect(remount.result.current.phase).toBe('login-required');
    expect(remount.result.current.refreshing).toBe(false);

    mocks.access.mockReturnValue(accessWith('unavailable', 'Syslab no disponible.'));
    remount.rerender();
    expect(remount.result.current.phase).toBe('unavailable');
    expect(remount.result.current.refreshing).toBe(false);
  });

  it('shows cached empty stay while checking access and holds downloads until verified', async () => {
    mocks.search.mockResolvedValueOnce({ success: true, data: [] });
    const { wrapper } = createQueryClientTestWrapper();
    const first = renderHook(() => useSyslabHospitalizationReports(defaultParams), { wrapper });
    await waitFor(() => expect(first.result.current.phase).toBe('empty'));
    first.unmount();

    mocks.access.mockReturnValue(accessWith('checking', 'Comprobando…'));
    const remount = renderHook(() => useSyslabHospitalizationReports(defaultParams), { wrapper });
    expect(remount.result.current.phase).toBe('empty');
    expect(remount.result.current.refreshing).toBe(true);
    expect(settleLabRead(remount.result.current)).toBeNull();

    mocks.access.mockReturnValue(connectedAccess);
    remount.rerender();
    expect(remount.result.current.phase).toBe('empty');
    expect(remount.result.current.refreshing).toBe(false);
    expect(settleLabRead(remount.result.current)).toEqual({ kind: 'empty' });
  });

  it('never serves a previous Eloísa session cache after session epoch changes', async () => {
    act(() => setSessionGeneration('session-a'));
    mocks.search.mockResolvedValueOnce({ success: true, data: [older] });
    const { wrapper } = createQueryClientTestWrapper();
    const first = renderHook(() => useSyslabHospitalizationReports(defaultParams), { wrapper });
    await waitFor(() => expect(first.result.current.phase).toBe('ready'));
    first.unmount();

    act(() => setSessionGeneration('session-b'));
    mocks.access.mockReturnValue(accessWith('checking', 'Comprobando…'));
    const remount = renderHook(() => useSyslabHospitalizationReports(defaultParams), { wrapper });
    expect(remount.result.current.phase).toBe('checking');
    expect(remount.result.current.refreshing).toBe(false);
  });

  it('stays in checking when disabled even if cached data exists', async () => {
    mocks.search.mockResolvedValueOnce({ success: true, data: [older] });
    const { wrapper } = createQueryClientTestWrapper();
    const first = renderHook(() => useSyslabHospitalizationReports(defaultParams), { wrapper });
    await waitFor(() => expect(first.result.current.phase).toBe('ready'));
    first.unmount();

    mocks.access.mockReturnValue(accessWith('checking', 'Comprobando…'));
    const disabled = renderHook(
      () => useSyslabHospitalizationReports({ ...defaultParams, enabled: false }),
      { wrapper }
    );
    expect(disabled.result.current.phase).toBe('checking');
    expect(disabled.result.current.refreshing).toBe(false);
  });
});
