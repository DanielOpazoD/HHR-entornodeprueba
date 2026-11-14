import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { buildInitialBackupBrowserPath } from '@/hooks/backupFileBrowserController';
import { DailyBackupCalendarView } from '@/features/backup/components/internal/DailyBackupCalendarView';
import { HandoffCalendarView } from '@/features/backup/components/internal/HandoffCalendarView';

// Exercise the real calendar range and hospital clock, with no date mocks.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const props = {
  files: [],
  onDownload: vi.fn(),
  onView: vi.fn(),
  onDelete: vi.fn(),
  canDelete: false,
  formatSize: () => '0 KB',
};

describe('backup calendars use the hospital day', () => {
  it.each([
    ['2026-11-01T03:30:00Z', '2026', 'Octubre'],
    ['2027-01-01T03:30:00Z', '2026', 'Diciembre'],
  ])('opens the hospital month at %s', (instant, year, month) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(instant));
    expect(buildInitialBackupBrowserPath()).toEqual([year, month]);
    expect(buildInitialBackupBrowserPath(new Date(instant))).toEqual([year, month]);
  });

  for (const Calendar of [DailyBackupCalendarView, HandoffCalendarView]) {
    describe(Calendar.name, () => {
      it.each([
        ['2026-11-01T03:30:00Z', 2026, 'Octubre', 31],
        ['2026-11-01T03:30:00Z', 2026, 'Noviembre', 30],
        ['2027-01-01T03:30:00Z', 2027, 'Enero', 31],
        ['2026-11-11T03:30:00Z', 2026, 'Noviembre', 10],
        ['2026-11-11T05:30:00Z', 2026, 'Noviembre', 11],
        ['2026-11-11T03:30:00Z', 2026, 'Octubre', 31],
      ])('renders the expected days at %s for %s %s', (instant, year, monthName, days) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(instant));
        render(<Calendar {...props} year={year} monthName={monthName} />);
        expect(screen.getAllByRole('row')).toHaveLength(days + 1);
      });
    });
  }
});
