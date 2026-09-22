import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import { resolveClinicalFillDay } from '@/features/rayen-import/hooks/clinicalFillDay';
import { resolveConfirmedRayenCensusHandoff } from '@/features/rayen-import/hooks/rayenCensusPersistenceGuard';
import type { SaveDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';

const recordFor = (date: string, runId: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: `${date}T12:00:00.000Z`,
    rayenSync: { runId, status: 'applied', at: `${date}T12:00:00.000Z`, by: 'Prueba' },
    rayenSyncHistory: [
      {
        id: runId,
        startedAt: `${date}T10:00:00.000Z`,
        by: 'Operador HHR',
        status: 'applied',
        policy: { mode: 'preview', revision: 1 },
      },
    ],
  }) as DailyRecord;

const handoff = (record: DailyRecord, clinicalDay: string) =>
  resolveConfirmedRayenCensusHandoff(
    {
      record,
      result: { date: record.date, outcome: 'clean' } as SaveDailyRecordResult,
    },
    { date: record.date, clinicalDay, runId: record.rayenSync?.runId ?? '' }
  );

describe('clinical fill day', () => {
  it('keeps the prior active shift for a pre-handoff calendar-day census', () => {
    const record = recordFor('2026-07-15', 'run-pre-handoff');
    expect(resolveClinicalFillDay(handoff(record, '2026-07-14'), record)).toBe('2026-07-14');
    expect(resolveClinicalFillDay(record, record)).toBe('2026-07-15');
  });

  it('uses the selected record day for a delayed historical clinical fill', () => {
    const record = recordFor('2026-09-20', 'run-delayed');
    expect(resolveClinicalFillDay(handoff(record, '2026-09-21'), record)).toBe('2026-09-20');
  });

  it('falls back to the selected record when the frozen clinical day is invalid', () => {
    const record = recordFor('2026-09-20', 'run-invalid-day');
    expect(resolveClinicalFillDay(handoff(record, '2026-02-30'), record)).toBe('2026-09-20');
  });
});
