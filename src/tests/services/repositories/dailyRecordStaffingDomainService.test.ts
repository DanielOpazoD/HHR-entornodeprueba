import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { resolveInheritedDailyRecordStaffing } from '@/services/repositories/dailyRecordStaffingDomainService';
import { applyDailyRecordStaffingCompatibility } from '@/services/staff/dailyRecordStaffing';

const buildRecord = (date: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: `${date}T08:00:00.000Z`,
    nurses: ['', ''],
    nursesDayShift: ['', ''],
    nursesNightShift: ['', ''],
    tensDayShift: ['', '', ''],
    tensNightShift: ['', '', ''],
    activeExtraBeds: [],
  }) as DailyRecord;

describe('dailyRecordStaffingDomainService', () => {
  it('leaves all next-day clinical staffing vacant', () => {
    const previous = buildRecord('2026-02-18');
    previous.nursesNightShift = ['N1', 'N2'];
    previous.tensNightShift = ['T1', 'T2', 'T3'];

    const result = resolveInheritedDailyRecordStaffing(previous);

    expect(result.nursesDay).toEqual(['', '']);
    expect(result.nursesNight).toEqual(['', '']);
    expect(result.tensDay).toEqual(['', '', '']);
    expect(result.tensNight).toEqual(['', '', '']);
  });

  it('does not carry previous night receivers into next-day nurses', () => {
    const previous = buildRecord('2026-02-18');
    previous.nursesNightShift = ['Entrega 1', 'Entrega 2'];
    previous.handoffNightReceives = ['Recibe 1', 'Recibe 2'];

    const result = resolveInheritedDailyRecordStaffing(previous);

    expect(result.nursesDay).toEqual(['', '']);
  });

  it('does not fall back to legacy day nurses when opening a new day', () => {
    const previous = buildRecord('2026-02-18');
    previous.nurses = ['Legacy A', 'Legacy B'];

    const result = resolveInheritedDailyRecordStaffing(previous);

    expect(result.nursesDay).toEqual(['', '']);
  });

  it('mirrors legacy staffing into canonical day shift compatibility shape', () => {
    const compat = applyDailyRecordStaffingCompatibility({
      ...buildRecord('2026-02-18'),
      nurses: ['Legacy A', 'Legacy B'],
      nurseName: 'Legacy Principal',
      nursesDayShift: ['', ''],
    });

    expect(compat.nursesDayShift).toEqual(['Legacy A', 'Legacy B']);
    expect(compat.nurses).toEqual(['Legacy A', 'Legacy B']);
  });
});
