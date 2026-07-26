import { describe, expect, it } from 'vitest';
import { resolveCensusSyncTarget } from '@/features/rayen-import/domain/historicalCensusSync';
import {
  resolveSyncReportRequest,
  syncReportRange,
} from '@/features/rayen-import/hooks/reportDateHelpers';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';

describe('Rayen sync report range', () => {
  it('covers every possible discharge from D-7 through the current clinical day', () => {
    const now = new Date('2026-07-24T18:00:00.000Z');
    const target = resolveCensusSyncTarget('2026-07-17', now);

    expect(syncReportRange('2026-07-17', target)).toEqual({
      dateStart: '2026-07-17',
      dateEnd: '2026-07-25',
    });
  });

  it('ends after the active clinical day before the morning handoff', () => {
    const beforeWeekendHandoff = new Date('2026-07-25T14:30:00.000Z');
    const target = resolveCensusSyncTarget('2026-07-23', beforeWeekendHandoff);

    expect(syncReportRange('2026-07-23', target)).toEqual({
      dateStart: '2026-07-23',
      dateEnd: '2026-07-26',
    });
  });

  it('rejects an unsupported target', () => {
    const target = resolveCensusSyncTarget('2026-07-16', new Date('2026-07-24T18:00:00.000Z'));
    expect(() => syncReportRange('2026-07-16', target)).toThrow('intervalo administrativo');
  });

  it('resolves the target and range as one guarded request', () => {
    const record = { date: '2026-07-17', beds: {} } as DailyRecord;
    const request = resolveSyncReportRequest(record, new Date('2026-07-24T18:00:00.000Z'));

    expect(request.target).toMatchObject({ kind: 'historical', lookbackDays: 7 });
    expect(request.range).toEqual({ dateStart: '2026-07-17', dateEnd: '2026-07-25' });
  });
});
