/**
 * DateStrip Component
 * Navigation bar with date selection, action buttons, and export functionality.
 */

import React, { useRef } from 'react';
import { PdfButtons, SaveDropdown, HandoffSaveDropdown, EmailDropdown } from './DateStripActions';
import { resolveShiftedMonthYear } from '@/components/layout/date-strip/dateStripNavigationController';
import { DateStripDayButtons } from '@/components/layout/date-strip/DateStripDayButtons';
import { DateStripQuickActions } from '@/components/layout/date-strip/DateStripQuickActions';
import { DateStripBookmarkToggle } from '@/components/layout/date-strip/DateStripBookmarkToggle';
import { DateStripYearNavigator } from '@/components/layout/date-strip/DateStripYearNavigator';
import { DateStripMonthNavigator } from '@/components/layout/date-strip/DateStripMonthNavigator';
import { useDateStripWheelNavigation } from '@/components/layout/date-strip/useDateStripWheelNavigation';

export interface DateNavigationProps {
  selectedYear: number;
  setSelectedYear: React.Dispatch<React.SetStateAction<number>>;
  selectedMonth: number;
  setSelectedMonth: React.Dispatch<React.SetStateAction<number>>;
  selectedDay: number;
  setSelectedDay: React.Dispatch<React.SetStateAction<number>>;
  currentDateString: string;
  daysInMonth: number;
  existingDaysInMonth: number[];
  navigateDays: (delta: number) => void;
}

export interface DateStripActionsProps {
  onExportPDF?: () => void;
  onOpenBedManager?: () => void;
  onExportExcel?: () => void;
  onBackupExcel?: () => Promise<void>;
  onBackupPDF?: () => Promise<void>;
  isArchived?: boolean;
  onBackupExcelStatus?: boolean;
}

export interface EmailConfigProps {
  onConfigureEmail?: () => void;
  onSendEmail?: () => void;
  onCopyShareLink?: () => void;
  emailStatus?: 'idle' | 'loading' | 'success' | 'error';
  emailErrorMessage?: string | null;
}

export interface SyncConfigProps {
  syncStatus?: 'idle' | 'saving' | 'saved' | 'error';
  lastSyncTime?: Date | null;
}

export interface BookmarkConfigProps {
  onToggleBookmarks?: () => void;
  showBookmarks?: boolean;
  role?: string;
}

export interface DateStripProps
  extends
    DateNavigationProps,
    DateStripActionsProps,
    EmailConfigProps,
    SyncConfigProps,
    BookmarkConfigProps {
  localViewMode: 'TABLE' | '3D';
  setLocalViewMode: (v: 'TABLE' | '3D') => void;
  isBackingUp: boolean;
  currentModule: string;
}

export const DateStrip: React.FC<DateStripProps> = ({
  selectedYear,
  setSelectedYear,
  selectedMonth,
  setSelectedMonth,
  selectedDay,
  setSelectedDay,
  currentDateString: _currentDateString,
  navigateDays,
  daysInMonth,
  existingDaysInMonth,
  onExportPDF,
  onOpenBedManager,
  onExportExcel,
  onBackupExcel,
  onBackupPDF,
  isArchived = false,
  onConfigureEmail,
  onSendEmail,
  onCopyShareLink,
  emailStatus = 'idle',
  emailErrorMessage,
  syncStatus: _syncStatus,
  lastSyncTime: _lastSyncTime,
  onToggleBookmarks,
  showBookmarks,
  role,
  localViewMode,
  setLocalViewMode,
  isBackingUp,
  currentModule,
}) => {
  const daysContainerRef = useRef<HTMLDivElement>(null);

  const isGuest = role === 'viewer';

  const changeMonth = (delta: number) => {
    const nextMonthYear = resolveShiftedMonthYear({
      month: selectedMonth,
      year: selectedYear,
      delta,
    });

    setSelectedMonth(nextMonthYear.month);
    setSelectedYear(nextMonthYear.year);
    setSelectedDay(1);
  };

  const today = new Date();
  const isCurrentMonth = today.getMonth() === selectedMonth && today.getFullYear() === selectedYear;

  useDateStripWheelNavigation({ containerRef: daysContainerRef, navigateDays });

  return (
    <div
      className="bg-white border-b border-slate-200 shadow-sm sticky top-[64px] z-40 print:hidden h-[48px] flex items-center"
      style={{ transform: 'translateZ(0)' }}
    >
      <div className="max-w-screen-2xl mx-auto px-4 py-1.5">
        <div className="flex items-center gap-3">
          {!isGuest && onToggleBookmarks && (
            <DateStripBookmarkToggle
              onToggleBookmarks={onToggleBookmarks}
              showBookmarks={showBookmarks}
            />
          )}

          <div className="flex items-center gap-1">
            {currentModule === 'NURSING_HANDOFF' && !isGuest && (
              <HandoffSaveDropdown
                onExportPDF={onExportPDF}
                onBackupPDF={onBackupPDF}
                isArchived={isArchived}
                isBackingUp={isBackingUp}
              />
            )}

            {currentModule === 'CENSUS' && (
              <>
                <PdfButtons onExportPDF={onExportPDF} />
                {!isGuest && (
                  <SaveDropdown
                    onExportExcel={onExportExcel}
                    onBackupExcel={onBackupExcel}
                    isArchived={isArchived}
                    isBackingUp={isBackingUp}
                  />
                )}
              </>
            )}
          </div>

          {!isGuest && (
            <EmailDropdown
              onSendEmail={onSendEmail}
              onCopyShareLink={onCopyShareLink}
              onConfigureEmail={onConfigureEmail}
              emailStatus={emailStatus}
              emailErrorMessage={emailErrorMessage}
            />
          )}

          <div className="h-5 w-px bg-slate-200" />

          <DateStripYearNavigator selectedYear={selectedYear} setSelectedYear={setSelectedYear} />

          <div className="h-5 w-px bg-slate-200" />

          <DateStripMonthNavigator selectedMonth={selectedMonth} onChangeMonth={changeMonth} />

          <div className="h-5 w-px bg-slate-200" />

          <div
            ref={daysContainerRef}
            className="flex gap-1 py-1 overflow-hidden flex-1 justify-center"
          >
            <DateStripDayButtons
              selectedDay={selectedDay}
              setSelectedDay={setSelectedDay}
              daysInMonth={daysInMonth}
              existingDaysInMonth={existingDaysInMonth}
              selectedYear={selectedYear}
              selectedMonth={selectedMonth}
              isCurrentMonth={isCurrentMonth}
              today={today}
            />
          </div>

          <div className="h-5 w-px bg-slate-200" />

          <DateStripQuickActions
            onOpenBedManager={onOpenBedManager}
            localViewMode={localViewMode}
            setLocalViewMode={setLocalViewMode}
          />
        </div>
      </div>
    </div>
  );
};
