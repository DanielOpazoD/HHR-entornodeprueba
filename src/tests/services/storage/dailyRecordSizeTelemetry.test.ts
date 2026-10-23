import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizeOperationalTelemetryEvent } from '@/services/observability/operationalTelemetryPrivacy';

const { recordOperationalTelemetry } = vi.hoisted(() => ({
  recordOperationalTelemetry: vi.fn(),
}));

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry,
}));

// Fresh module per test: the version counter is per browser session.
const loadTelemetry = async () => {
  vi.resetModules();
  return import('@/services/storage/firestore/dailyRecordSizeTelemetry');
};

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

const heavy = {
  clinicalSyncCheckpoint: { capturedAt: '2026-10-23T08:00:00Z', items: ['a', 'b'] },
  vitalSignsHistory: [{ at: '08:00', heartRate: 80 }],
  evaluationScores: { braden: 18 },
};
const cribHeavy = { vitalSignsHistory: [{ at: '09:00', heartRate: 140 }] };
const movementHeavy = { evaluationScores: { braden: 12 } };
const syntheticDay = (lastUpdated: string, extra: Record<string, unknown> = {}) => ({
  date: '2026-10-23',
  lastUpdated,
  meta: { revision: 3 },
  beds: {
    R1: {
      patientName: 'Paciente Sintético',
      rut: '11.111.111-1',
      ...heavy,
      clinicalCrib: { patientName: 'RN Sintético', ...cribHeavy },
    },
    R2: { patientName: '  ', rut: '' },
  },
  rayenSyncHistory: [{ runId: 'run-1', status: 'ok' }],
  discharges: [{ id: 'd1', originalData: { patientName: 'Alta Sintética', ...movementHeavy } }],
  transfers: [{ id: 't1' }],
  ...extra,
});

describe('daily record size telemetry', () => {
  beforeEach(() => {
    recordOperationalTelemetry.mockReset();
  });

  it('measures the whole day, the derived per-bed data, the embedded sync log and occupied beds', async () => {
    const { measureDailyRecordDocument } = await loadTelemetry();
    const day = syntheticDay('2026-10-23T08:00:00Z');

    const checkpointBytes = bytes(heavy.clinicalSyncCheckpoint);
    const vitalsHistoryBytes = bytes(heavy.vitalSignsHistory) + bytes(cribHeavy.vitalSignsHistory);
    const scoresBytes = bytes(heavy.evaluationScores);
    expect(measureDailyRecordDocument(day)).toEqual({
      sizeBytes: bytes(day),
      derivedBytes: checkpointBytes + vitalsHistoryBytes + scoresBytes,
      checkpointBytes,
      vitalsHistoryBytes,
      scoresBytes,
      movementDerivedBytes: bytes(movementHeavy.evaluationScores),
      syncHistoryBytes: bytes(day.rayenSyncHistory),
      occupiedCount: 1,
    });
    expect(measureDailyRecordDocument({ beds: ['not', 'a', 'map'] })).toEqual({
      sizeBytes: bytes({ beds: ['not', 'a', 'map'] }),
      derivedBytes: 0,
      checkpointBytes: 0,
      vitalsHistoryBytes: 0,
      scoresBytes: 0,
      movementDerivedBytes: 0,
      syncHistoryBytes: 0,
      occupiedCount: 0,
    });
  });

  it('reports the first server version of a day and then only the 10th, 50th and 200th', async () => {
    const { observeDailyRecordServerSnapshot } = await loadTelemetry();

    for (let version = 1; version <= 200; version += 1) {
      const day = syntheticDay(`v${version}`);
      observeDailyRecordServerSnapshot('2026-10-23', day);
      // A repeated version (metadata-only snapshot) is not a new download.
      observeDailyRecordServerSnapshot('2026-10-23', day);
    }

    expect(recordOperationalTelemetry.mock.calls.map(([event]) => event.context.count)).toEqual([
      1, 10, 50, 200,
    ]);
    const [event, options] = recordOperationalTelemetry.mock.calls[0];
    expect(options).toEqual({ allowSuccess: true });
    expect(event).toMatchObject({
      category: 'daily_record',
      operation: 'daily_record_size_observed',
      status: 'success',
      date: '2026-10-23',
      context: { occupiedCount: 1, count: 1 },
    });
    expect(event).not.toHaveProperty('issues');
  });

  it('counts versions separately for each day', async () => {
    const { observeDailyRecordServerSnapshot } = await loadTelemetry();

    observeDailyRecordServerSnapshot('2026-10-22', syntheticDay('a'));
    observeDailyRecordServerSnapshot('2026-10-23', syntheticDay('a'));

    expect(recordOperationalTelemetry.mock.calls.map(([event]) => event.date)).toEqual([
      '2026-10-22',
      '2026-10-23',
    ]);
  });

  it('flags a day at or above 700 KB as degraded', async () => {
    const { observeDailyRecordServerSnapshot, DAILY_RECORD_SIZE_WARNING_BYTES } =
      await loadTelemetry();

    observeDailyRecordServerSnapshot(
      '2026-10-23',
      syntheticDay('big', { padding: 'x'.repeat(DAILY_RECORD_SIZE_WARNING_BYTES) })
    );

    const [event] = recordOperationalTelemetry.mock.calls[0];
    expect(event).toMatchObject({
      status: 'degraded',
      runtimeState: 'degraded',
      issues: [expect.stringContaining('700 KB')],
    });
    expect(event.context.sizeBytes).toBeGreaterThanOrEqual(DAILY_RECORD_SIZE_WARNING_BYTES);
  });

  it('keeps every measurement through the privacy allowlist that guards what leaves the device', async () => {
    const { observeDailyRecordServerSnapshot } = await loadTelemetry();
    observeDailyRecordServerSnapshot('2026-10-23', syntheticDay('v1'));
    const [event] = recordOperationalTelemetry.mock.calls[0];

    expect(
      sanitizeOperationalTelemetryEvent({ ...event, timestamp: '2026-10-23T08:00:00.000Z' })
    ).toMatchObject({
      category: 'daily_record',
      status: 'success',
      operation: 'daily_record_size_observed',
      date: '2026-10-23',
      context: {
        sizeBytes: event.context.sizeBytes,
        derivedBytes: event.context.derivedBytes,
        syncHistoryBytes: event.context.syncHistoryBytes,
        checkpointBytes: event.context.checkpointBytes,
        vitalsHistoryBytes: event.context.vitalsHistoryBytes,
        scoresBytes: event.context.scoresBytes,
        movementDerivedBytes: event.context.movementDerivedBytes,
        occupiedCount: 1,
        count: 1,
      },
      droppedContextKeys: [],
    });
    // Only sizes and counts leave the device, never patient data.
    expect(JSON.stringify(event)).not.toMatch(/Sintético|11\.111\.111-1/);
  });
});
