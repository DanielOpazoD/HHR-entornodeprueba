// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  buildChecklistUpdateRecord,
  buildNovedadesUpdateRecord,
} from '@/domain/handoff/management';

const createRecord = (): DailyRecord =>
  DataFactory.createMockDailyRecord('2026-03-03', {
    beds: {},
    handoffDayChecklist: {},
    handoffNightChecklist: {},
    handoffNovedadesDayShift: '',
    handoffNovedadesNightShift: '',
    lastUpdated: '',
  });

describe('handoff management domain', () => {
  it('builds checklist and novedades updates immutably', () => {
    const record = createRecord();

    const checklistRecord = buildChecklistUpdateRecord(record, 'day', 'escalaBraden', true);
    const novedadesRecord = buildNovedadesUpdateRecord(record, 'night', 'Sin novedades');

    expect(checklistRecord.handoffDayChecklist?.escalaBraden).toBe(true);
    expect(novedadesRecord.handoffNovedadesNightShift).toBe('Sin novedades');
    expect(record.handoffDayChecklist?.escalaBraden).toBeUndefined();
  });
});
