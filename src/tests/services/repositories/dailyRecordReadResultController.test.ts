import { describe, expect, it } from 'vitest';
import {
  createLocalRuntimeReadCandidate,
  createLocalRuntimeReadResult,
  createNotFoundDailyRecordReadResult,
} from '@/services/repositories/dailyRecordReadResultController';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const buildRecord = (date: string, lastUpdated: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated,
    nurses: [],
    nursesDayShift: [],
    nursesNightShift: [],
    tensDayShift: [],
    tensNightShift: [],
    activeExtraBeds: [],
    handoffDayChecklist: {},
    handoffNightChecklist: {},
    handoffNightReceives: [],
    handoffNovedadesDayShift: '',
    handoffNovedadesNightShift: '',
    medicalHandoffNovedades: '',
    schemaVersion: 1,
  }) as DailyRecord;

describe('dailyRecordReadResultController', () => {
  it('creates a local runtime read result from a migrated candidate', () => {
    const record = buildRecord('2026-04-15', '2026-04-15T12:00:00.000Z');
    const candidate = createLocalRuntimeReadCandidate(record.date, record);

    const result = createLocalRuntimeReadResult(record.date, candidate, 'indexeddb');

    expect(result.source).toBe('indexeddb');
    expect(result.record?.date).toBe('2026-04-15');
    expect(result.compatibilityTier).toBe('local_runtime');
  });

  it('creates explicit not-found results for missing previous-day lookups', () => {
    const result = createNotFoundDailyRecordReadResult('2026-04-15', 'missing');

    expect(result.source).toBe('not_found');
    expect(result.record).toBeNull();
    expect(result.consistencyState).toBe('missing');
  });
});
