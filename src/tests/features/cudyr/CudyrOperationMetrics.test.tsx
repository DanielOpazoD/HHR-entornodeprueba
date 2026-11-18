import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCudyrReport } from '@/features/cudyr/hooks/useCudyrReport';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { reportInput } from '@/tests/services/cudyr/reportFixtures';
import {
  admitSyntheticSession,
  clearSyntheticSession,
  replaceStoredSessionOwner,
} from '@/tests/utils/syntheticSession';

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
vi.mock('@/features/cudyr/report/cudyrReadView', () => ({
  readCudyrReadView: vi.fn(),
  saveCudyrReadView: vi.fn(),
}));
vi.mock('@/services/cudyr/cudyrReportLoader', () => ({ loadCudyrReport: vi.fn() }));
const dataset = () => buildCudyrReport(reportInput({ from: '2026-10-01', to: '2026-10-02' }));
beforeEach(() => {
  admitSyntheticSession('metrics', '1');
  vi.mocked(recordOperationalTelemetry).mockClear();
});

afterEach(clearSyntheticSession);

describe('CUDYR report operation measurements', () => {
  it('distinguishes a real read, cache reuse and failed refresh without clinical context', async () => {
    const loader = vi.fn().mockResolvedValue(dataset());
    const { result } = renderHook(() => useCudyrReport('2026-10-02', loader));
    await waitFor(() => expect(result.current.busy).toBe(false));
    await act(async () => result.current.load('2026-10-01', '2026-10-02', true));
    expect(loader).toHaveBeenCalledOnce();
    loader.mockRejectedValueOnce(new Error('Private source detail'));
    await act(async () => result.current.load('2026-10-01', '2026-10-02'));
    expect(result.current.data).not.toBeNull();
    const events = vi.mocked(recordOperationalTelemetry).mock.calls.map(([event]) => event);
    expect(events.map(event => [event.operation, event.status])).toEqual([
      ['cudyr_report_read', 'success'],
      ['cudyr_report_reuse', 'success'],
      ['cudyr_report_read', 'failed'],
    ]);
    for (const event of events) {
      expect(event.context?.durationMs).toBeGreaterThanOrEqual(0);
      expect(Object.keys(event.context!)).toEqual(
        event.status === 'failed' ? ['durationMs'] : ['durationMs', 'rowCount']
      );
      expect(event).not.toHaveProperty('issues');
      expect(event).not.toHaveProperty('date');
    }
  });
  it.each(['unmount', 'session change'])('does not count a late read after %s', async mode => {
    let finish!: (data: ReturnType<typeof dataset>) => void;
    const loader = vi.fn(
      () =>
        new Promise<ReturnType<typeof dataset>>(resolve => {
          finish = resolve;
        })
    );
    const view = renderHook(() => useCudyrReport('2026-10-02', loader));
    if (mode === 'unmount') view.unmount();
    else replaceStoredSessionOwner('other');
    await act(async () => finish(dataset()));
    expect(recordOperationalTelemetry).not.toHaveBeenCalled();
  });
});
