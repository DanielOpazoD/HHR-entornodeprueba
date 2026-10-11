// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { BaseStoredFile } from '@/services/backup/baseStorageService';
import type { StoredPdfFile } from '@/services/backup/pdfStorageService';
import { __testing } from '@/services/backup/monthlyBackfillService';

vi.mock('@/utils/dateRangeUtils', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/dateRangeUtils')>();
  return {
    ...actual,
    generateDateRange: () => ['2026-02-01', '2026-02-02', '2026-02-03'],
  };
});

vi.mock('@/utils/clinicalDayUtils', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/clinicalDayUtils')>();
  return {
    ...actual,
    getShiftSchedule: () => ({
      dayStart: '08:00',
      dayEnd: '20:00',
      nightStart: '20:00',
      nightEnd: '08:00',
      description: 'test',
    }),
  };
});

const createRecord = (date: string): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: `${date}T00:00:00.000Z`,
  nurses: [],
  activeExtraBeds: [],
});

const createStoredFile = (date: string): BaseStoredFile => ({
  name: `${date}.xlsx`,
  fullPath: date,
  downloadUrl: `https://example.com/${date}`,
  date,
  createdAt: `${date}T00:00:00.000Z`,
  size: 1,
});

const createStoredPdf = (date: string, shiftType: 'day' | 'night'): StoredPdfFile => ({
  ...createStoredFile(date),
  shiftType,
});

describe('monthlyBackfillService planner', () => {
  it('builds pending tasks for census using missing record dates', () => {
    const plan = __testing.createMonthlyBackfillPlan(
      'census',
      [createRecord('2026-02-01'), createRecord('2026-02-02')],
      [createStoredFile('2026-02-01')],
      2026,
      2
    );

    expect(plan.tasks).toEqual([{ type: 'census', date: '2026-02-02' }]);
    expect(plan.skippedNoRecordDates).toEqual(['2026-02-03']);
  });

  it('builds pending tasks for handoff per date and shift', () => {
    const plan = __testing.createMonthlyBackfillPlan(
      'handoff',
      [createRecord('2026-02-01'), createRecord('2026-02-02')],
      [createStoredPdf('2026-02-01', 'day')],
      2026,
      2
    );

    expect(plan.tasks).toEqual([
      { type: 'handoff', date: '2026-02-01', shiftType: 'night' },
      { type: 'handoff', date: '2026-02-02', shiftType: 'day' },
      { type: 'handoff', date: '2026-02-02', shiftType: 'night' },
    ]);
    expect(plan.skippedNoRecordDates).toEqual(['2026-02-03']);
  });
});

describe('monthlyBackfillService execution', () => {
  it('returns an empty result without processing when there are no planned tasks', async () => {
    const processTask = vi.fn();

    const result = await __testing.runMonthlyBackfillTasks({
      tasks: [],
      skippedNoRecordDates: ['2026-02-03'],
      processTask,
    });

    expect(processTask).not.toHaveBeenCalled();
    expect(result).toEqual({
      totalPlanned: 0,
      created: 0,
      failed: 0,
      skippedNoRecord: 1,
      errors: [],
    });
  });

  it('continues after a task failure and reports progress plus errors', async () => {
    const onProgress = vi.fn();
    const processTask = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('upload failed'));

    const result = await __testing.runMonthlyBackfillTasks({
      tasks: [
        { type: 'census', date: '2026-02-01' },
        { type: 'census', date: '2026-02-02' },
      ],
      skippedNoRecordDates: ['2026-02-03'],
      onProgress,
      processTask,
    });

    expect(processTask).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      totalPlanned: 2,
      created: 1,
      failed: 1,
      skippedNoRecord: 1,
      errors: ['2026-02-02: upload failed'],
    });
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      completed: 0,
      total: 2,
      currentLabel: '2026-02-01',
    });
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      completed: 1,
      total: 2,
      currentLabel: '2026-02-01',
    });
    expect(onProgress).toHaveBeenNthCalledWith(3, {
      completed: 1,
      total: 2,
      currentLabel: '2026-02-02',
    });
    expect(onProgress).toHaveBeenNthCalledWith(4, {
      completed: 2,
      total: 2,
      currentLabel: '2026-02-02',
    });
  });
});
