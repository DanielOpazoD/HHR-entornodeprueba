import { renderHook } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecordBootstrapPhase } from '@/hooks/controllers/dailyRecordBootstrapController';
import type { OperationalTelemetryEvent } from '@/services/observability/operationalTelemetryTypes';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(async (_event: OperationalTelemetryEvent) => true),
}));
vi.mock('@/services/observability/operationalTelemetryExternalAdapter', () => ({
  dispatchOperationalTelemetryExternally: mocks.dispatch,
}));

import { createOperationalTelemetryHandler } from '../../../../netlify/functions/operational-telemetry';
import type { AlertQueue } from '../../../../netlify/functions/lib/telemetry-alerts/queueTypes';
import { parseOperationalTelemetryBody } from '@/services/observability/operationalTelemetryIngestPolicy';
import { getOperationalTelemetryEvents } from '@/services/observability/operationalTelemetryRecorder';
import {
  DAILY_ACTION_SUMMARY_INTERVAL_MS,
  flushDailyActionTimings,
  recordDailyActionTiming,
  startDailyActionTiming,
} from '@/services/observability/dailyActionTiming';
import { setSessionGeneration } from '@/services/session/sessionStorageTransition';
import { useCensusDayChangeTiming } from '@/hooks/useCensusRecordPerf';

const envelope = (event: unknown) => JSON.stringify({ source: 'hhr_operational_telemetry', event });
const sent = () => mocks.dispatch.mock.calls.map(([event]) => event);
const ingest = (event: OperationalTelemetryEvent) => {
  const parsed = parseOperationalTelemetryBody(envelope(event));
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.event;
};

/** Summary timers still pending: created with the 15-minute interval and not cleared since. */
const watchSummaryTimers = () => {
  const set = vi.spyOn(globalThis, 'setTimeout');
  const clear = vi.spyOn(globalThis, 'clearTimeout');
  return () => {
    const cleared = new Set(clear.mock.calls.map(([id]) => id));
    return set.mock.calls
      .map(([, delay], index) => [delay, set.mock.results[index]?.value] as const)
      .filter(([delay, id]) => delay === DAILY_ACTION_SUMMARY_INTERVAL_MS && !cleared.has(id))
      .length;
  };
};

/** The same line the authenticated app runs: measuring lives as long as its owner is mounted. */
const mountOwner = () => renderHook(() => useEffect(() => startDailyActionTiming(), []));

describe('daily action timing', () => {
  let stopSuiteOwner: () => void;
  beforeEach(() => {
    mocks.dispatch.mockClear();
    vi.stubEnv('URL', 'https://testinghhr.netlify.app');
    stopSuiteOwner = startDailyActionTiming();
  });
  afterEach(() => {
    stopSuiteOwner();
    setSessionGeneration(null);
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('sends one summary per action with closed numbers only, and nothing without actions', () => {
    for (const ms of [100, 200, 300, 400, 5_000])
      recordDailyActionTiming('census_edit_saved', 0, true, ms);
    recordDailyActionTiming('census_edit_saved', 0, false, 50);
    recordDailyActionTiming('clinical_panel_ready', 1_000, true, 1_234.6);
    expect(sent()).toHaveLength(0);

    flushDailyActionTimings();
    const [edits, panels] = sent().map(ingest);
    expect(edits).toMatchObject({
      operation: 'census_edit_saved',
      status: 'success',
      issues: [],
      droppedContextKeys: [],
      context: { count: 6, degradedCount: 1, p50Ms: 200, p90Ms: 5_000, maxMs: 5_000 },
    });
    expect(edits.date).toBeUndefined();
    expect(panels.context).toEqual({
      count: 1,
      degradedCount: 0,
      p50Ms: 235,
      p90Ms: 235,
      maxMs: 235,
    });

    flushDailyActionTimings();
    expect(sent()).toHaveLength(2);
  });

  it('flushes every 15 minutes and when the tab is hidden', () => {
    vi.useFakeTimers();
    recordDailyActionTiming('census_day_change_ready', 0, true, 10);
    vi.advanceTimersByTime(DAILY_ACTION_SUMMARY_INTERVAL_MS - 1);
    expect(sent()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(sent()).toHaveLength(1);

    recordDailyActionTiming('census_day_change_ready', 0, true, 10);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    expect(sent()).toHaveLength(2);
    vi.advanceTimersByTime(DAILY_ACTION_SUMMARY_INTERVAL_MS);
    expect(sent()).toHaveLength(2);
  });

  it('keeps a real failure deliverable after a burst of 250 actions', async () => {
    for (let action = 0; action < 250; action += 1) {
      recordDailyActionTiming(
        (['census_edit_saved', 'clinical_panel_ready', 'census_day_change_ready'] as const)[
          action % 3
        ],
        0,
        action % 7 !== 0,
        action
      );
    }
    flushDailyActionTimings();
    expect(sent().length).toBeLessThanOrEqual(3);

    const enqueue = vi.fn(async () => ({ alert: 'queued' as const, id: 'job-1' }));
    const queue = {
      enqueue,
      deliver: vi.fn(async () => ({ alert: 'sent' })),
      drain: vi.fn(),
    } as unknown as AlertQueue;
    const handler = createOperationalTelemetryHandler({
      queue: () => queue,
      now: () => Date.now(),
      log: () => undefined,
    });
    const post = (event: unknown) =>
      handler({
        httpMethod: 'POST',
        headers: {
          origin: 'https://testinghhr.netlify.app',
          'x-nf-client-connection-ip': '192.0.2.77',
        },
        body: envelope(event),
      });
    for (const summary of sent()) expect((await post(summary)).statusCode).toBe(202);
    const failure = await post({
      category: 'integration',
      status: 'failed',
      operation: 'rayen_sync_run',
      timestamp: '2026-11-15T12:00:00.000Z',
      issues: ['persistence_issue'],
      context: { durationMs: 91_000 },
    });
    expect(failure.statusCode).toBe(202);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('stays out of the local buffer that keeps failures for diagnostics and system health', () => {
    const before = getOperationalTelemetryEvents().length;
    for (let edit = 0; edit < 250; edit += 1)
      recordDailyActionTiming('census_edit_saved', 0, true, 5);
    flushDailyActionTimings();
    expect(getOperationalTelemetryEvents()).toHaveLength(before);
  });

  it('never reports a negative wait when the clock moves backwards', () => {
    recordDailyActionTiming('census_day_change_ready', 500, true, 200);
    flushDailyActionTimings();
    expect(ingest(sent()[0]).context).toMatchObject({ p50Ms: 0, maxMs: 0 });
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
    flushDailyActionTimings();

    expect(
      sent().map(event => [event.operation, event.context?.count, event.context?.degradedCount])
    ).toEqual([['census_day_change_ready', 2, 1]]);
  });

  it('never summarises one person with the next: a logout drops the open window and its timer', () => {
    vi.useFakeTimers();
    const summaryTimers = watchSummaryTimers();
    setSessionGeneration('session-a', 'user:a');
    recordDailyActionTiming('census_edit_saved', 0, true, 100);
    expect(summaryTimers()).toBe(1);

    setSessionGeneration(null);
    expect(summaryTimers()).toBe(0);
    setSessionGeneration('session-b', 'user:b');
    recordDailyActionTiming('census_edit_saved', 0, true, 900);
    flushDailyActionTimings();

    expect(sent().map(event => event.context)).toEqual([
      { count: 1, degradedCount: 0, p50Ms: 900, p90Ms: 900, maxMs: 900 },
    ]);
  });

  it('does the same across unmounting and mounting the owner, with one set of listeners', () => {
    stopSuiteOwner();
    vi.useFakeTimers();
    const summaryTimers = watchSummaryTimers();
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');
    const visibilityListeners = () =>
      added.mock.calls.filter(([type]) => type === 'visibilitychange').length -
      removed.mock.calls.filter(([type]) => type === 'visibilitychange').length;

    let owner = mountOwner();
    setSessionGeneration('session-a', 'user:a');
    recordDailyActionTiming('census_edit_saved', 0, true, 100);
    owner.unmount();
    expect(summaryTimers()).toBe(0);
    expect(visibilityListeners()).toBe(0);
    recordDailyActionTiming('census_edit_saved', 0, true, 500);
    expect(summaryTimers()).toBe(0);

    setSessionGeneration('session-b', 'user:b');
    owner = mountOwner();
    owner.unmount();
    owner = mountOwner();
    expect(visibilityListeners()).toBe(1);
    recordDailyActionTiming('census_edit_saved', 0, true, 900);
    expect(summaryTimers()).toBe(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });

    expect(sent().map(event => event.context)).toEqual([
      { count: 1, degradedCount: 0, p50Ms: 900, p90Ms: 900, maxMs: 900 },
    ]);
    expect(summaryTimers()).toBe(0);
    owner.unmount();
    expect(visibilityListeners()).toBe(0);
    stopSuiteOwner = startDailyActionTiming();
  });
});
