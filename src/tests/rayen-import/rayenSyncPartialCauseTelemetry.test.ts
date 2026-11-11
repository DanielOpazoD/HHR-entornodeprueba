import { act, renderHook } from '@testing-library/react';
import type { OperationalTelemetryEvent } from '@/services/observability/operationalTelemetryTypes';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Every partial Eloísa run reached production telemetry as `unclassified_issue` with only its
 * duration, so the causes had to be dug out of the day's history. What leaves the device must now
 * say which source failed and why, as counts of closed codes and nothing that names a patient.
 */

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(async (_event: OperationalTelemetryEvent) => undefined),
}));

vi.mock('@/services/observability/operationalTelemetryExternalAdapter', () => ({
  dispatchOperationalTelemetryExternally: mocks.dispatch,
}));

import { useRayenSyncAudit } from '@/features/rayen-import/hooks/useRayenSyncAudit';
import { sanitizeOperationalTelemetryEvent } from '@/services/observability/operationalTelemetryPrivacy';
import { clearOperationalTelemetryEvents } from '@/services/observability/operationalTelemetryRecorder';
import type { ClinicalFillError } from '@/features/rayen-import/contracts/clinicalFillContracts';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const PATIENT = 'Paciente Sintético Uno';
const RUT = '11.111.111-1';
const EPISODE = 'synthetic-episode-77';

const record = (): DailyRecord =>
  ({
    date: '2026-11-08',
    beds: {
      R1: { bedId: 'R1', patientName: PATIENT, rut: RUT, clinicalEpisodeId: EPISODE },
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2026-11-08T09:00:00.000Z',
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
    unchangedCount: 1,
    summary: {
      admissions: 0,
      updates: 0,
      moves: 0,
      discharges: 0,
      pendingAdministrativeDischarges: 0,
      conflicts: 0,
      unchanged: 1,
    },
  }) as CensusImportDiff;

const error = (
  count: number,
  fields: Omit<ClinicalFillError, 'bedId' | 'message' | 'clinicalEpisodeId'>
): ClinicalFillError[] =>
  Array.from({ length: count }, (_, index) => ({
    bedId: `R${index + 1}`,
    clinicalEpisodeId: `${EPISODE}-${index}`,
    message: `${PATIENT} ${RUT}: el campo clínico cambió`,
    ...fields,
  }));

// Seven source/cause pairs; only the six most frequent fit the recorder's context.
const mixedErrors = (): ClinicalFillError[] => [
  ...error(18, { source: 'patch', reason: 'write_failed', cause: 'batch_field_changed' }),
  ...error(1, { source: 'bed_history', reason: 'source_unavailable' }),
  ...error(3, { source: 'vitals', reason: 'source_unavailable', cause: 'episode_not_authorized' }),
  ...error(2, { source: 'scales', reason: 'source_unavailable', cause: 'session_required' }),
  ...error(2, { source: 'patch', reason: 'write_failed' }),
  ...error(1, { source: 'cudyr', reason: 'source_timeout', cause: 'source_timeout' }),
  ...error(1, { source: 'devices', reason: 'unexpected' }),
];

describe('partial Eloísa run · telemetry causes', () => {
  afterEach(() => {
    mocks.dispatch.mockClear();
    clearOperationalTelemetryEvents();
  });

  it('sends counts by source and cause, without identities, through the privacy gate', async () => {
    const patchDailyRecord = vi.fn().mockResolvedValue(undefined);
    const currentRecordRef = { current: record() };
    const { result } = renderHook(() =>
      useRayenSyncAudit({
        currentRecordRef,
        patchDailyRecord,
        actor: 'SYNTHETIC A',
        createId: () => 'synthetic-partial-run',
      })
    );
    act(() => result.current.startRun());
    const applied = result.current.applyRunToRecord(currentRecordRef.current, diff()).record;
    currentRecordRef.current = applied;
    await act(async () => {
      await result.current.completeRun(applied, { total: 30, patched: 2, errors: mixedErrors() });
    });

    expect(mocks.dispatch).toHaveBeenCalledOnce();
    const sent = sanitizeOperationalTelemetryEvent(mocks.dispatch.mock.calls[0]![0]);
    expect(sent).toMatchObject({ status: 'partial', operation: 'rayen_sync_run' });
    expect(sent.context).toEqual({
      durationMs: expect.any(Number),
      issueCount: 28,
      patientCount: 18,
      'patch:batch_field_changed': 18,
      'vitals:episode_not_authorized': 3,
      'patch:write_failed': 2,
      'scales:session_required': 2,
      'bed_history:source_unavailable': 1,
      'cudyr:source_timeout': 1,
    });
    // runId and outcome are local-only and dropped; nothing else was refused.
    expect(sent.droppedContextKeys).toHaveLength(2);
    const serialized = JSON.stringify(sent);
    for (const secret of [PATIENT, RUT, EPISODE, 'R1', 'campo clínico']) {
      expect(serialized).not.toContain(secret);
    }
  });
});
