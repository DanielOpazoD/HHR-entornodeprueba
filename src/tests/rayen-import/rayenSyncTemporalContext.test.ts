import { describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import {
  createRayenSyncExecutionContext,
  prepareRayenSyncTemporalContext,
  validatePreparedRayenSyncContextAtCompletion,
} from '@/features/rayen-import/hooks/rayenSyncTemporalContext';

const recordFor = (date: string, lastUpdated: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated,
  }) as DailyRecord;

describe('prepareRayenSyncTemporalContext', () => {
  it('freezes D-1 against the freshest persisted version before requesting Rayen', async () => {
    const displayed = recordFor('2026-08-07', '2026-08-08T10:00:00.000Z');
    const fresh = recordFor('2026-08-07', '2026-08-08T12:00:00.000Z');
    const loadFreshRecord = vi.fn().mockResolvedValue(fresh);

    const context = await prepareRayenSyncTemporalContext({
      displayedRecord: displayed,
      runId: 'run-d-1',
      loadFreshRecord,
      now: () => new Date('2026-08-08T18:00:00.000Z'),
    });

    expect(loadFreshRecord).toHaveBeenCalledOnce();
    expect(loadFreshRecord).toHaveBeenCalledWith('2026-08-07');
    expect(context).toMatchObject({
      runId: 'run-d-1',
      selectedDate: '2026-08-07',
      record: fresh,
      target: { kind: 'historical', clinicalDay: '2026-08-08', lookbackDays: 1 },
      range: { dateStart: '2026-08-07', dateEnd: '2026-08-09' },
      preparedAt: '2026-08-08T18:00:00.000Z',
    });
  });

  it.each([
    ['2026-08-08', 'current', 0],
    ['2026-08-07', 'historical', 1],
    ['2026-08-06', 'historical', 2],
    ['2026-08-05', 'historical', 3],
    ['2026-08-04', 'historical', 4],
    ['2026-08-03', 'historical', 5],
    ['2026-08-02', 'historical', 6],
    ['2026-08-01', 'historical', 7],
  ] as const)(
    'creates an immutable execution context for %s',
    async (selectedDate, target, lookbackDays) => {
      const fresh = recordFor(selectedDate, 'revision-7');
      const prepared = await prepareRayenSyncTemporalContext({
        displayedRecord: fresh,
        runId: `run-${lookbackDays}`,
        loadFreshRecord: vi.fn().mockResolvedValue(fresh),
        now: () => new Date('2026-08-08T18:00:00.000Z'),
      });
      const policy = { mode: 'preview', clinicalBatchMode: 'shadow', revision: 12 } as const;

      const context = createRayenSyncExecutionContext(prepared, `request-${lookbackDays}`, policy);

      expect(context).toMatchObject({
        runId: `run-${lookbackDays}`,
        requestId: `request-${lookbackDays}`,
        selectedDate,
        clinicalDay: '2026-08-08',
        timeZone: 'Pacific/Easter',
        target,
        lookbackDays,
        baseRevision: 'revision-7',
        policyRevision: 12,
      });
      expect(context.policy).toEqual(policy);
      expect(Object.isFrozen(context.policy)).toBe(true);
      expect(Object.isFrozen(context.queryRange)).toBe(true);
    }
  );

  it('rejects a loader result from a different census day', async () => {
    await expect(
      prepareRayenSyncTemporalContext({
        displayedRecord: recordFor('2026-08-07', '2026-08-08T10:00:00.000Z'),
        runId: 'run-wrong-day',
        loadFreshRecord: vi
          .fn()
          .mockResolvedValue(recordFor('2026-08-08', '2026-08-08T12:00:00.000Z')),
        now: () => new Date('2026-08-08T18:00:00.000Z'),
      })
    ).rejects.toThrow('día de censo seleccionado');
  });

  it('rejects a census outside the seven-day reconstruction window', async () => {
    await expect(
      prepareRayenSyncTemporalContext({
        displayedRecord: recordFor('2026-07-30', '2026-08-08T10:00:00.000Z'),
        runId: 'run-too-old',
        loadFreshRecord: vi
          .fn()
          .mockResolvedValue(recordFor('2026-07-30', '2026-08-08T12:00:00.000Z')),
        now: () => new Date('2026-08-08T18:00:00.000Z'),
      })
    ).rejects.toThrow('hasta siete días clínicos anteriores');
  });

  it('keeps a prepared context valid while the same clinical shift remains active', async () => {
    const context = await prepareRayenSyncTemporalContext({
      displayedRecord: recordFor('2026-08-07', '2026-08-08T10:00:00.000Z'),
      runId: 'run-same-shift',
      loadFreshRecord: vi
        .fn()
        .mockResolvedValue(recordFor('2026-08-07', '2026-08-08T12:00:00.000Z')),
      now: () => new Date('2026-08-08T18:00:00.000Z'),
    });

    expect(
      validatePreparedRayenSyncContextAtCompletion(context, new Date('2026-08-08T18:05:00.000Z'))
    ).toMatchObject({ valid: true });
  });

  it('rejects a capture that crosses the nursing handoff into another clinical day', async () => {
    const context = await prepareRayenSyncTemporalContext({
      displayedRecord: recordFor('2026-08-07', '2026-08-08T10:00:00.000Z'),
      runId: 'run-crossed-handoff',
      loadFreshRecord: vi
        .fn()
        .mockResolvedValue(recordFor('2026-08-07', '2026-08-08T12:00:00.000Z')),
      now: () => new Date('2026-08-08T18:00:00.000Z'),
    });

    expect(
      validatePreparedRayenSyncContextAtCompletion(context, new Date('2026-08-09T20:00:00.000Z'))
    ).toMatchObject({ valid: false, reason: 'clinical_day_changed' });
  });
});
