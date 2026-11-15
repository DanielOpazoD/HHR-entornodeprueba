import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecordBootstrapPhase } from '@/hooks/controllers/dailyRecordBootstrapController';
import type { OperationalTelemetryEvent } from '@/services/observability/operationalTelemetryTypes';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(async (_event: OperationalTelemetryEvent) => true),
}));
vi.mock('@/services/observability/operationalTelemetryExternalAdapter', () => ({
  dispatchOperationalTelemetryExternally: mocks.dispatch,
}));

import {
  parseOperationalTelemetryBody,
  shouldAlertOperationalTelemetry,
} from '@/services/observability/operationalTelemetryIngestPolicy';
import { getOperationalTelemetryEvents } from '@/services/observability/operationalTelemetryRecorder';
import {
  recordDailyActionTiming,
  type DailyAction,
} from '@/services/observability/dailyActionTiming';
import { useCensusDayChangeTiming } from '@/hooks/useCensusRecordPerf';

const ACTIONS: DailyAction[] = [
  'census_day_change_ready',
  'census_edit_saved',
  'clinical_panel_ready',
];

const ingest = (event: OperationalTelemetryEvent) => {
  const parsed = parseOperationalTelemetryBody(
    JSON.stringify({ source: 'hhr_operational_telemetry', event })
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.event;
};

describe('daily action timing', () => {
  afterEach(() => mocks.dispatch.mockClear());

  it.each(ACTIONS)('%s reaches the server as its name, its outcome and a duration only', action => {
    recordDailyActionTiming(action, 1_000, true, 1_234.6);
    recordDailyActionTiming(action, 1_000, false, 41_000);

    const [done, unfinished] = mocks.dispatch.mock.calls.map(([event]) => ingest(event));
    expect(done).toMatchObject({
      operation: action,
      status: 'success',
      context: { durationMs: 235 },
      droppedContextKeys: [],
      issues: [],
    });
    expect(done.date).toBeUndefined();
    expect(unfinished).toMatchObject({ status: 'degraded', context: { durationMs: 40_000 } });
    expect([done, unfinished].some(shouldAlertOperationalTelemetry)).toBe(false);
  });

  it('stays out of the local buffer that keeps failures for diagnostics and system health', () => {
    const before = getOperationalTelemetryEvents().length;
    for (let edit = 0; edit < 250; edit += 1)
      recordDailyActionTiming('census_edit_saved', 0, true, 5);
    expect(getOperationalTelemetryEvents()).toHaveLength(before);
  });

  it('never reports a negative wait when the clock moves backwards', () => {
    recordDailyActionTiming('census_day_change_ready', 500, true, 200);
    expect(ingest(mocks.dispatch.mock.calls[0][0]).context).toEqual({ durationMs: 0 });
  });

  it('counts a day left before it showed as nothing, and a day that never loaded as unfinished', () => {
    type Props = { date: string; recordDate?: string; phase: DailyRecordBootstrapPhase };
    const { rerender } = renderHook(
      ({ date, recordDate, phase }: Props) => useCensusDayChangeTiming(date, recordDate, phase),
      { initialProps: { date: '2026-11-14', recordDate: '2026-11-14', phase: 'record_ready' } }
    );
    rerender({ date: '2026-11-15', recordDate: undefined, phase: 'remote_record_bootstrapping' });
    rerender({ date: '2026-11-16', recordDate: undefined, phase: 'remote_record_bootstrapping' });
    rerender({ date: '2026-11-16', recordDate: undefined, phase: 'remote_record_timeout' });
    rerender({ date: '2026-11-16', recordDate: '2026-11-16', phase: 'record_ready' });
    rerender({ date: '2026-11-17', recordDate: undefined, phase: 'confirmed_empty' });

    expect(mocks.dispatch.mock.calls.map(([event]) => [event.operation, event.status])).toEqual([
      ['census_day_change_ready', 'degraded'],
      ['census_day_change_ready', 'success'],
    ]);
  });
});
