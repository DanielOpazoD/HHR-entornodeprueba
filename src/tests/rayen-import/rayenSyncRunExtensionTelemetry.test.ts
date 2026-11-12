import { act, renderHook } from '@testing-library/react';
import type { OperationalTelemetryEvent } from '@/services/observability/operationalTelemetryTypes';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Three runs failed in about a second with `ficha_read_blocked` on 11-10 and 11-11, after the
 * extension that should have prevented it (0.48.91) was pinned. The event did not say which
 * extension the computer had, so nobody could tell a broken fix from an outdated extension.
 * Every terminal run event now names the version and the start of the package fingerprint,
 * bounded by the same privacy gate the server runs.
 */

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(async (_event: OperationalTelemetryEvent) => undefined),
}));

vi.mock('@/services/observability/operationalTelemetryExternalAdapter', () => ({
  dispatchOperationalTelemetryExternally: mocks.dispatch,
}));

import { parseOperationalTelemetryBody } from '@/services/observability/operationalTelemetryIngestPolicy';
import { clearOperationalTelemetryEvents } from '@/services/observability/operationalTelemetryRecorder';
import { useRayenSyncAudit } from '@/features/rayen-import/hooks/useRayenSyncAudit';
import type { RayenExtensionHealthState } from '@/features/rayen-import/hooks/useRayenExtensionHealth';
import type { RayenExtensionHealthReport } from '@/features/rayen-import/bridge/extensionHealthBridge';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const BUILD_ID = '0123456789abcdef'.repeat(4);

const health = (report: Partial<RayenExtensionHealthReport> = {}): RayenExtensionHealthState => ({
  connection: 'ready',
  canSync: true,
  message: '',
  report: {
    version: '0.48.91',
    buildId: BUILD_ID,
    protocolVersion: 3,
    checkedAt: '2026-11-11T14:04:59.000Z',
    fichaMedico: { status: 'ready', message: '' },
    gestionCamas: { status: 'ready', message: '' },
    ...report,
  },
});

const record = (): DailyRecord =>
  ({
    date: '2026-11-11',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2026-11-11T09:00:00.000Z',
    activeExtraBeds: [],
  }) as unknown as DailyRecord;

const diff = (): CensusImportDiff =>
  ({
    admissions: [],
    updates: [],
    moves: [],
    discharges: [],
    pendingAdministrativeDischarges: [],
    conflicts: [],
    unchangedCount: 0,
    summary: {
      admissions: 0,
      updates: 0,
      moves: 0,
      discharges: 0,
      pendingAdministrativeDischarges: 0,
      conflicts: 0,
      unchanged: 0,
    },
  }) as CensusImportDiff;

const renderAudit = (patchDailyRecord = vi.fn().mockResolvedValue(undefined)) => {
  const currentRecordRef = { current: record() as DailyRecord | null };
  const hook = renderHook(() =>
    useRayenSyncAudit({
      currentRecordRef,
      patchDailyRecord,
      actor: 'SYNTHETIC',
      createId: () => 'synthetic-run',
    })
  );
  return { ...hook, currentRecordRef };
};

/** What the Netlify receiver keeps of the one event the app sent. */
const received = () => {
  expect(mocks.dispatch).toHaveBeenCalledOnce();
  const parsed = parseOperationalTelemetryBody(
    JSON.stringify({ source: 'hhr_operational_telemetry', event: mocks.dispatch.mock.calls[0]![0] })
  );
  if (!parsed.ok) throw new Error(`rejected: ${parsed.reason}`);
  return parsed.event;
};

describe('Eloísa run telemetry · installed extension', () => {
  afterEach(() => {
    mocks.dispatch.mockClear();
    clearOperationalTelemetryEvents();
  });

  it('says which extension a run that failed at capture had', async () => {
    const { result } = renderAudit();
    act(() => void result.current.startRun(health()));
    await act(async () =>
      result.current.failRun('snapshot_network_error', undefined, undefined, 'ficha_read_blocked')
    );

    const event = received();
    expect(event).toMatchObject({ status: 'failed', operation: 'rayen_sync_run' });
    expect(event.context).toMatchObject({
      captureCheck: 'ficha_read_blocked',
      extensionVersion: '0.48.91',
      extensionBuild: '0123456789ab',
    });
  });

  it('says which extension a partial run had', async () => {
    const { result, currentRecordRef } = renderAudit();
    act(() => void result.current.startRun(health()));
    const applied = result.current.applyRunToRecord(currentRecordRef.current!, diff()).record;
    currentRecordRef.current = applied;
    await act(async () =>
      result.current.completeRun(applied, {
        total: 2,
        patched: 1,
        errors: [
          {
            bedId: 'R1',
            message: 'synthetic',
            source: 'vitals',
            reason: 'source_unavailable',
          },
        ],
      })
    );

    const event = received();
    expect(event.status).toBe('partial');
    expect(event.context).toMatchObject({
      extensionVersion: '0.48.91',
      extensionBuild: '0123456789ab',
      'vitals:source_unavailable': 1,
    });
  });

  it('says which extension a run whose final save failed had', async () => {
    const patchDailyRecord = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(undefined);
    const { result, currentRecordRef } = renderAudit(patchDailyRecord);
    act(() => void result.current.startRun(health()));
    const stamped = await act(async () =>
      result.current.persistAppliedRun(currentRecordRef.current!, diff())
    );
    currentRecordRef.current = stamped;
    await act(async () =>
      expect(
        result.current.completeRun(stamped, { total: 1, patched: 1, errors: [] })
      ).rejects.toThrow('network unavailable')
    );

    const event = received();
    expect(event.status).toBe('failed');
    expect(event.context).toMatchObject({
      extensionVersion: '0.48.91',
      extensionBuild: '0123456789ab',
    });
  });

  it('leaves out what the extension did not report, never a free text', async () => {
    const { result } = renderAudit();
    act(
      () =>
        void result.current.startRun(health({ version: 'dev local carpeta', buildId: undefined }))
    );
    await act(async () => result.current.failRun('snapshot_network_error'));

    const event = received();
    expect(event.context).not.toHaveProperty('extensionVersion');
    expect(event.context).not.toHaveProperty('extensionBuild');
    expect(JSON.stringify(event)).not.toContain('carpeta');
  });

  it('leaves both out when the run started without a health report', async () => {
    const { result } = renderAudit();
    act(() => void result.current.startRun());
    await act(async () => result.current.failRun('extension_unavailable'));

    const event = received();
    expect(event.context).not.toHaveProperty('extensionVersion');
    expect(event.context).not.toHaveProperty('extensionBuild');
  });
});
