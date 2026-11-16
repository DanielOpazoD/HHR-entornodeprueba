// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { buildStabilityRules } from '@/hooks/stabilityRulesController';

const createRecord = (date: string): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: `${date}T08:00:00.000Z`,
  nurses: [],
  activeExtraBeds: [],
});

describe('stabilityRulesController', () => {
  it('returns locked rules when there is no record', () => {
    const rules = buildStabilityRules(null, { isAdmin: false, isEditor: true });

    expect(rules.isDateLocked).toBe(true);
    expect(rules.canPerformActions).toBe(false);
    expect(rules.canEditField('any')).toBe(false);
  });

  it('returns locked rules for non-editor users', () => {
    const record = createRecord('2025-01-10');
    const rules = buildStabilityRules(record, { isAdmin: false, isEditor: false });

    expect(rules.isDateLocked).toBe(true);
    expect(rules.canPerformActions).toBe(false);
  });

  it('allows admin edits on historical records', () => {
    const record = createRecord('2025-01-10');
    const rules = buildStabilityRules(record, {
      isAdmin: true,
      isEditor: true,
      todayISO: '2025-01-12',
      now: new Date('2025-01-12T12:00:00.000Z'),
    });

    expect(rules.isDateLocked).toBe(false);
    expect(rules.canPerformActions).toBe(true);
    expect(rules.canEditField('handoffNoteDayShift')).toBe(true);
  });

  it('unlocks historical record within grace period', () => {
    const record = createRecord('2025-01-10');
    const rules = buildStabilityRules(record, {
      isAdmin: false,
      isEditor: true,
      todayISO: '2025-01-11',
      now: new Date('2025-01-11T14:00:00'),
    });

    expect(rules.isDateLocked).toBe(false);
    expect(rules.canPerformActions).toBe(true);
  });

  it('locks historical record outside grace period', () => {
    const record = createRecord('2025-01-10');
    const rules = buildStabilityRules(record, {
      isAdmin: false,
      isEditor: true,
      todayISO: '2025-01-11',
      now: new Date('2025-01-12T23:00:00'),
    });

    expect(rules.isDateLocked).toBe(true);
    expect(rules.canPerformActions).toBe(false);
    expect(rules.canEditField('handoffNoteNightShift')).toBe(false);
  });

  it('uses the clinical day instead of the calendar day during the overnight window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 22, 6, 59, 0));

    const record = createRecord('2026-04-21');
    const rules = buildStabilityRules(record, {
      isAdmin: false,
      isEditor: true,
      now: new Date(2026, 3, 22, 6, 59, 0),
    });

    expect(rules.isDateLocked).toBe(false);
    expect(rules.canPerformActions).toBe(true);

    vi.useRealTimers();
  });
});
