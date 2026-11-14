import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { DateRangeSelector } from '@/features/analytics/components/internal/DateRangeSelector';
import { resolveLabExamIdsByDays } from '@/features/laboratory/controllers/labViewerController';
import { buildRayenSyncBarViewModel } from '@/features/rayen-import/components/rayenSyncBarViewModel';
import {
  resolveYearToDateFileSuffix,
  resolveYearToDateRange,
} from '@/services/admin/dataMaintenanceSupport';
import { __testing as monthlyBackfill } from '@/services/backup/monthlyBackfillService';
import type { SyslabExamItem } from '@/types/domain/labExamTypes';

// 22:30 on the last day of the month (and of the year) in Rapa Nui (UTC-5) is already the next
// day in UTC, on a mainland device (Santiago, 00:30) and in Auckland (16:30). Every answer below
// must stay on the hospital day, whatever zone the device runs in.
const MONTH_END = new Date('2026-12-01T03:30:00.000Z');
const YEAR_END = new Date('2027-01-01T03:30:00.000Z');
// 00:30 on December 1 in Rapa Nui is still November 30 on a device in Pago Pago (UTC-11).
const NEW_DAY = new Date('2026-12-01T05:30:00.000Z');
const DEVICE_ZONES = [
  'UTC',
  'America/Santiago',
  'Pacific/Easter',
  'Pacific/Auckland',
  'Pacific/Pago_Pago',
];

const deviceZone = process.env.TZ;
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (deviceZone === undefined) delete process.env.TZ;
  else process.env.TZ = deviceZone;
});

const onDevice = (zone: string, now?: Date) => {
  process.env.TZ = zone;
  if (now) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  }
};

const exam = (id: string, date: string): SyslabExamItem => ({
  id,
  link: `http://lab/exam/${id}`,
  date,
  time: '09:00:00',
  patientName: 'PACIENTE SINTETICO',
  origin: 'HOSPITALIZADOS',
  exams: ['PCR'],
});

describe.each(DEVICE_ZONES)('hospital calendar day on a device in %s', zone => {
  it('exports the hospital year to date at 22:30 on December 31', () => {
    onDevice(zone);
    expect(resolveYearToDateRange(2026, YEAR_END)).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      isCurrentYear: true,
    });
    expect(resolveYearToDateFileSuffix(2026, YEAR_END)).toBe('Diciembre_31');
    expect(resolveYearToDateRange(2027, YEAR_END).isCurrentYear).toBe(false);
  });

  it('plans the monthly backfill of a month that has not started in the hospital', () => {
    onDevice(zone, MONTH_END);
    const december = monthlyBackfill.createMonthlyBackfillPlan('census', [], [], 2026, 12);
    const november = monthlyBackfill.createMonthlyBackfillPlan('census', [], [], 2026, 11);
    // December has not started in the hospital: it is listed like any later month, not cut at today.
    expect(december.skippedNoRecordDates).toHaveLength(31);
    expect(november.skippedNoRecordDates).toHaveLength(30);
    expect(november.skippedNoRecordDates.at(-1)).toBe('2026-11-30');
  });

  it('counts the last days of laboratory exams in hospital days', () => {
    onDevice(zone);
    const examList = [
      exam('today', '30/11/2026'),
      exam('third-day-back', '27/11/2026'),
      exam('fourth-day-back', '26/11/2026'),
    ];
    expect(resolveLabExamIdsByDays({ examList, days: 3, now: MONTH_END })).toEqual([
      'today',
      'third-day-back',
    ]);
  });

  it('keeps the exams of the new hospital day just after midnight', () => {
    onDevice(zone);
    const examList = [exam('new-day', '01/12/2026'), exam('previous-day', '30/11/2026')];
    expect(resolveLabExamIdsByDays({ examList, days: 1, now: NEW_DAY })).toEqual([
      'new-day',
      'previous-day',
    ]);
  });

  it('shows the age of the last reading while the visible census is the hospital day', () => {
    onDevice(zone);
    const synchronizedAt = new Date(MONTH_END.getTime() - 30 * 60_000).toISOString();
    const model = buildRayenSyncBarViewModel({
      diff: null,
      error: null,
      fill: {
        running: false,
        outcome: 'idle',
        attemptId: 0,
        done: 0,
        total: 0,
        errors: 0,
        lastCompletedAt: null,
        staffingOutcome: 'idle',
      },
      now: MONTH_END.getTime(),
      targetDate: '2026-11-30',
      hasPersistedSync: true,
      persistedSync: {
        at: synchronizedAt,
        status: 'complete',
        coverage: {
          total: 1,
          completed: 1,
          errors: 0,
          sourceErrors: 0,
          completedAt: synchronizedAt,
        },
        staffingObservation: { ambiguousSections: [], ignoredBoundaryRecords: 0 },
      },
    });
    expect(model).toMatchObject({ phase: 'idle', label: 'Última lectura · hace 30 min' });
  });

  it('offers every month of the hospital year in the analytics month selector', () => {
    onDevice(zone, YEAR_END);
    render(
      <DateRangeSelector
        currentPreset="currentMonth"
        onPresetChange={vi.fn()}
        onCustomRangeChange={vi.fn()}
        onCurrentYearMonthChange={vi.fn()}
      />
    );
    expect(screen.getByText('Mes (2026):')).toBeInTheDocument();
    const select = screen.getByRole('combobox');
    expect(select).toHaveValue('12');
    expect(screen.getAllByRole('option')).toHaveLength(12);
  });
});
