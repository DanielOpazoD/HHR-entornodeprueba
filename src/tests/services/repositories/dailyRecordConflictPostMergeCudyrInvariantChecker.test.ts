import { describe, expect, it } from 'vitest';
import { evaluateDailyRecordConflictPostMergeInvariants } from '@/services/repositories/dailyRecordConflictPostMergeInvariantChecker';
import { CUDYR_SCORE_FIELDS } from '@/domain/cudyr/cudyrCompletion';
import type { CudyrScore } from '@/types/domain/cudyr';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const completeCudyr = (value = 1): CudyrScore =>
  Object.fromEntries(CUDYR_SCORE_FIELDS.map(field => [field, value])) as unknown as CudyrScore;

const makeRecord = (lastUpdated: string): DailyRecord =>
  ({
    date: '2026-07-16',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    nurses: [],
    activeExtraBeds: [],
    lastUpdated,
  }) as DailyRecord;

const makePatient = (
  patientName: string,
  extras: Partial<DailyRecord['beds'][string]> = {}
): DailyRecord['beds'][string] =>
  ({
    bedId: 'R1',
    patientName,
    rut: '1-1',
    admissionDate: '2026-07-15',
    ...extras,
  }) as DailyRecord['beds'][string];

const evaluate = (remote: DailyRecord, resolved: DailyRecord) =>
  evaluateDailyRecordConflictPostMergeInvariants({
    remote,
    local: resolved,
    resolved,
    context: { date: '2026-07-16', phase: 'sync_publish' },
  });

describe('dailyRecord CUDYR post-merge invariants', () => {
  it('blocks a delayed merge that makes a closed CUDYR population incomplete', () => {
    const remote = makeRecord('2026-07-17T01:05:00.000Z');
    remote.cudyrLocked = true;
    remote.cudyrShiftDate = '2026-07-16';
    remote.beds = { R1: makePatient('Paciente uno', { cudyr: completeCudyr() }) };
    const resolved = {
      ...remote,
      beds: { ...remote.beds, R2: makePatient('Paciente nuevo') },
    };

    const result = evaluate(remote, resolved);

    expect(result.status).toBe('blocked');
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'cudyr_changed_after_remote_completion',
          path: 'cudyrLocked',
        }),
      ])
    );
  });

  it('blocks conflict resolution that replaces immutable CUDYR closure attribution', () => {
    const remote = makeRecord('2026-07-17T01:05:00.000Z');
    Object.assign(remote, {
      cudyrLocked: true,
      cudyrLockedAt: '2026-07-17T01:05:00.000Z',
      cudyrLockedBy: 'nurse-1',
      cudyrShiftDate: '2026-07-16',
      cudyrCompletedAt: '2026-07-17T01:05:00.000Z',
      cudyrCompletedBy: 'Enfermera Noche',
      beds: { R1: makePatient('Paciente uno', { cudyr: completeCudyr() }) },
    });
    const resolved = { ...remote, cudyrCompletedBy: 'Identidad atrasada' };

    const result = evaluate(remote, resolved);

    expect(result.status).toBe('blocked');
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'cudyr_changed_after_remote_completion',
          path: 'cudyrCompletedBy',
        }),
      ])
    );
  });

  it('blocks a stale merge that introduces a lock before the merged CUDYR is complete', () => {
    const remote = makeRecord('2026-07-17T01:00:00.000Z');
    remote.beds = {
      R1: makePatient('Paciente pendiente', { cudyr: { changeClothes: 1 } as never }),
    };

    const result = evaluate(remote, { ...remote, cudyrLocked: true });

    expect(result.status).toBe('blocked');
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'cudyrLocked' })])
    );
  });

  it('blocks a new complete lock attributed to a different shift date', () => {
    const remote = makeRecord('2026-07-17T01:00:00.000Z');
    remote.beds = { R1: makePatient('Paciente completo', { cudyr: completeCudyr() }) };
    const resolved = {
      ...remote,
      cudyrLocked: true,
      cudyrShiftDate: '2026-07-15',
      cudyrUpdatedAt: '2026-07-17T01:05:00.000Z',
      cudyrUpdatedBy: 'Enfermera Noche',
      cudyrUpdatedById: 'nurse-1',
    };

    expect(evaluate(remote, resolved)).toMatchObject({
      status: 'blocked',
      violations: expect.arrayContaining([expect.objectContaining({ path: 'cudyrLocked' })]),
    });
  });

  it('allows unrelated conflict recovery for an unchanged legacy manual incomplete lock', () => {
    const remote = makeRecord('2026-07-17T01:00:00.000Z');
    Object.assign(remote, {
      cudyrLocked: true,
      cudyrLockedAt: '2026-07-17T01:00:00.000Z',
      cudyrLockedBy: 'legacy-user',
      beds: {
        R1: makePatient('Paciente legado', { cudyr: { changeClothes: 1 } as never }),
      },
    });
    const resolved = { ...remote, handoffNovedadesNightShift: 'Cambio no relacionado' };

    const result = evaluate(remote, resolved);

    expect(result.status).toBe('ok');
    expect(result.record.cudyrLocked).toBe(true);
  });
});
