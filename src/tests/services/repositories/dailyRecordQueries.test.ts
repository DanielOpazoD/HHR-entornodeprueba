// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createDailyRecordReadResult,
  createGetDailyRecordQuery,
  createGetPreviousDayQuery,
} from '@/services/repositories/contracts/dailyRecordQueries';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const createMockRecord = (date: string): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: `${date}T00:00:00.000Z`,
  nurses: [],
  nursesDayShift: [],
  nursesNightShift: [],
  tensDayShift: [],
  tensNightShift: [],
  activeExtraBeds: [],
});

describe('dailyRecordQueries contracts', () => {
  it('validates ISO date for getForDate query', () => {
    expect(() => createGetDailyRecordQuery('2026-02-19')).not.toThrow();
    expect(() => createGetDailyRecordQuery('19-02-2026')).toThrow(/Invalid date format/);
  });

  it('validates ISO date for getPreviousDay query', () => {
    expect(() => createGetPreviousDayQuery('2026-02-19')).not.toThrow();
    expect(() => createGetPreviousDayQuery('2026/02/19')).toThrow(/Invalid date format/);
  });

  it('fails read result when record date mismatches query date', () => {
    const record = createMockRecord('2026-02-18');
    expect(() => createDailyRecordReadResult('2026-02-19', record, 'indexeddb')).toThrow(
      /date mismatch/
    );
  });

  it('creates read result when record and query date match', () => {
    const record = createMockRecord('2026-02-19');
    const result = createDailyRecordReadResult('2026-02-19', record, 'firestore', {
      compatibilityTier: 'current_firestore',
      compatibilityIntensity: 'normalized_only',
      migrationRulesApplied: ['schema_defaults_applied'],
    });
    expect(result.source).toBe('firestore');
    expect(result.record?.date).toBe('2026-02-19');
    expect(result.compatibilityTier).toBe('current_firestore');
    expect(result.compatibilityIntensity).toBe('normalized_only');
    expect(result.migrationRulesApplied).toContain('schema_defaults_applied');
  });
});
