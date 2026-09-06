/**
 * DateStrip Component
 * Navigation bar with date selection, action buttons, and export functionality.
 */

import React, { useRef } from 'react';
import { CalendarClock, Search } from 'lucide-react';
import { resolveShiftedMonthYear } from '@/components/layout/date-strip/dateStripNavigationController';
import { DateStripDayButtons } from '@/components/layout/date-strip/DateStripDayButtons';
import type { MedicalIndicationsPatientOption } from '@/shared/contracts/medicalIndications';
import { useDateStripWheelNavigation } from '@/components/layout/date-strip/useDateStripWheelNavigation';
import type { CensusAccessProfile } from '@/shared/access/censusAccessProfile';
import { isSpecialistCensusAccessProfile } from '@/shared/access/censusAccessProfile';
import type { ModuleType } from '@/constants/navigationConfig';

const SaveDropdown = React.lazy(() =>
  import('./date-strip/actions/SaveDropdown').then(module => ({
    default: module.SaveDropdown,
  }))
);
const HandoffSaveDropdown = React.lazy(() =>
  import('./date-strip/actions/HandoffSaveDropdown').then(module => ({
    default: module.HandoffSaveDropdown,
  }))
);
const EmailDropdown = React.lazy(() =>
  import('./date-strip/actions/EmailDropdown').then(module => ({
    default: module.EmailDropdown,
  }))
);
const PdfButtons = React.lazy(() =>
  import('./date-strip/actions/PdfButtons').then(module => ({
    default: module.PdfButtons,
  }))
);
const DateStripQuickActions = React.lazy(() =>
  import('@/components/layout/date-strip/DateStripQuickActions').then(module => ({
    default: module.DateStripQuickActions,
  }))
);
const DateStripBookmarkToggle = React.lazy(() =>
  import('@/components/layout/date-strip/DateStripBookmarkToggle').then(module => ({
    default: module.DateStripBookmarkToggle,
  }))
);
const DateStripYearNavigator = React.lazy(() =>
  import('@/components/layout/date-strip/DateStripYearNavigator').then(module => ({
    default: module.DateStripYearNavigator,
  }))
);
const DateStripMonthNavigator = React.lazy(() =>
  import('@/components/layout/date-strip/DateStripMonthNavigator').then(module => ({
    default: module.DateStripMonthNavigator,
  }))
);

const DateStripActionFallback = ({ widthClassName }: { widthClassName: string }) => (
  <div
    className={`h-[30px] shrink-0 rounded-lg border border-slate-100 bg-slate-50/70 ${widthClassName}`}
    aria-hidden="true"
  />
);

export interface DateNavigationProps {
  selectedYear: number;
  setSelectedYear: React.Dispatch<React.SetStateAction<number>>;
  selectedMonth: number;
  setSelectedMonth: React.Dispatch<React.SetStateAction<number>>;
  selectedDay: number;
  setSelectedDay: React.Dispatch<React.SetStateAction<number>>;
  currentDateString: string;
  /** Active clinical day (08:00/09:00 shift rollover) — drives the HOY marker. */
  clinicalToday?: string;
  /** Jump the selection back to the clinical day (the "Ir a hoy" affordance). */
  goToClinicalToday?: () => void;
  daysInMonth: number;
  existingDaysInMonth: number[];
  navigateDays: (delta: number) => void;
}

export interface DateStripActionsProps {
  onExportPDF?: () => void;
  onPrintWithBrowserOptions?: () => void;
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
  emailBlockedReason?: string | null;
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
  isBackingUp: boolean;
  currentModule: ModuleType;
  accessProfile?: CensusAccessProfile;
  medicalIndicationsPatients?: MedicalIndicationsPatientOption[];
  renderFeatureQuickActions?: (patients: MedicalIndicationsPatientOption[]) => React.ReactNode;
  onOpenPatientSearch?: () => void;
  hideQuickActions?: boolean;
  trailingActions?: React.ReactNode;
}

export const DateStrip: React.FC<DateStripProps> = ({
  hideQuickActions = false,
  trailingActions,
  selectedYear,
  setSelectedYear,
  selectedMonth,
  setSelectedMonth,
  selectedDay,
  setSelectedDay,
  currentDateString,
  clinicalToday,
  goToClinicalToday,
  navigateDays,
  daysInMonth,
  existingDaysInMonth,
  onExportPDF,
  onPrintWithBrowserOptions,
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
  emailBlockedReason,
  syncStatus: _syncStatus,
  lastSyncTime: _lastSyncTime,
  onToggleBookmarks,
  showBookmarks,
  role,
  isBackingUp,
  currentModule,
  accessProfile = 'default',
  medicalIndicationsPatients = [],
  renderFeatureQuickActions,
  onOpenPatientSearch,
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
  const specialistCensusAccess =
    currentModule === 'CENSUS' && isSpecialistCensusAccessProfile(accessProfile);
  const isHandoffModule =
    currentModule === 'NURSING_HANDOFF' || currentModule === 'MEDICAL_HANDOFF';
  const canShowRoleRestrictedActions = !isGuest && !specialistCensusAccess;

  // "Ir a hoy" is census-only (where editing the wrong day corrupts a clinical
  // record) and only when the viewed day is not the clinical today.
  const isViewingClinicalToday = !clinicalToday || currentDateString === clinicalToday;
  const showGoToToday =
    currentModule === 'CENSUS' && !isViewingClinicalToday && Boolean(goToClinicalToday);

  useDateStripWheelNavigation({ containerRef: daysContainerRef, navigateDays });

  return (
    <div
      data-app-top-bar
      className="bg-white border-b border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.06)] sticky top-[56px] z-40 print:hidden h-[40px] flex items-center"
      style={{ transform: 'translateZ(0)' }}
    >
      <div className="max-w-screen-2xl mx-auto px-2 py-0.5 w-full flex items-center">
        <div className="flex min-w-0 flex-1 items-center justify-center gap-2 max-md:justify-start max-md:overflow-x-auto">
          <div className="flex items-center gap-1 shrink-0 min-w-0">
            {!isGuest && onToggleBookmarks && (
              <React.Suspense fallback={<DateStripActionFallback widthClassName="w-[30px]" />}>
                <DateStripBookmarkToggle
                  onToggleBookmarks={onToggleBookmarks}
                  showBookmarks={showBookmarks}
                />
              </React.Suspense>
            )}

            {currentModule === 'NURSING_HANDOFF' && !isGuest && (
              <React.Suspense fallback={<DateStripActionFallback widthClassName="min-w-[40px]" />}>
                <HandoffSaveDropdown
                  onExportPDF={onExportPDF}
                  onPrintWithBrowserOptions={onPrintWithBrowserOptions}
                  onBackupPDF={onBackupPDF}
                  isArchived={isArchived}
                  isBackingUp={isBackingUp}
                  showFirebaseBackupOption={false}
                />
              </React.Suspense>
            )}

            {currentModule === 'CENSUS' && canShowRoleRestrictedActions && (
              <React.Suspense fallback={<DateStripActionFallback widthClassName="w-[34px]" />}>
                <SaveDropdown
                  onExportExcel={onExportExcel}
                  onBackupExcel={onBackupExcel}
                  isArchived={isArchived}
                  isBackingUp={isBackingUp}
                  showFirebaseBackupOption={false}
                />
              </React.Suspense>
            )}

            {canShowRoleRestrictedActions && (
              <React.Suspense fallback={<DateStripActionFallback widthClassName="min-w-[116px]" />}>
                <EmailDropdown
                  onSendEmail={onSendEmail}
                  onCopyShareLink={onCopyShareLink}
                  onConfigureEmail={onConfigureEmail}
                  emailStatus={emailStatus}
                  emailErrorMessage={emailErrorMessage}
                  emailBlockedReason={emailBlockedReason}
                />
              </React.Suspense>
            )}

            {currentModule === 'CENSUS' && (
              <React.Suspense fallback={<DateStripActionFallback widthClassName="w-[54px]" />}>
                <PdfButtons onExportPDF={onExportPDF} />
              </React.Suspense>
            )}
          </div>

          <div className="h-4 w-px bg-slate-200/70" />

          <React.Suspense fallback={<DateStripActionFallback widthClassName="w-[78px]" />}>
            <DateStripYearNavigator selectedYear={selectedYear} setSelectedYear={setSelectedYear} />
          </React.Suspense>

          <div className="h-4 w-px bg-slate-200/70" />

          <React.Suspense fallback={<DateStripActionFallback widthClassName="w-[104px]" />}>
            <DateStripMonthNavigator
              selectedMonth={selectedMonth}
              onChangeMonth={changeMonth}
              onSelectMonth={(month: number) => {
                setSelectedMonth(month);
                setSelectedDay(1);
              }}
            />
          </React.Suspense>

          <div className="h-4 w-px bg-slate-200/70" />

          <div
            ref={daysContainerRef}
            className="flex gap-1 py-0.5 overflow-hidden justify-center shrink-0"
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
              clinicalToday={clinicalToday}
              currentModule={currentModule}
            />
          </div>

          {showGoToToday && (
            <button
              onClick={goToClinicalToday}
              aria-label="Ir a hoy"
              className="flex h-[30px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-2.5 py-0 text-[10px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800"
              title="Volver al día de hoy"
            >
              <CalendarClock size={13} aria-hidden="true" />
              <span className="hidden sm:inline">Ir a hoy</span>
            </button>
          )}

          {!hideQuickActions && <div className="h-4 w-px bg-slate-200/70" />}

          {!hideQuickActions && (
            <div className="flex min-w-0 shrink-0 items-center justify-end gap-1 overflow-x-auto">
              {!isHandoffModule && onOpenPatientSearch && (
                <button
                  onClick={onOpenPatientSearch}
                  className="flex h-[30px] items-center justify-center gap-1 px-3 py-0 bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-700 rounded-lg border border-slate-200 transition-colors text-[10px] font-semibold min-w-[96px]"
                  title="Buscar paciente (Ctrl+K)"
                >
                  <Search size={13} />
                  <span className="hidden sm:inline">Buscar</span>
                </button>
              )}

              <React.Suspense
                fallback={
                  <div
                    className="h-[30px] w-[168px] shrink-0 rounded-lg border border-slate-100 bg-slate-50/70"
                    aria-hidden="true"
                  />
                }
              >
                <DateStripQuickActions
                  onOpenBedManager={specialistCensusAccess ? undefined : onOpenBedManager}
                  renderFeatureQuickActions={renderFeatureQuickActions}
                  hideClinicalQuickActions={isHandoffModule}
                  medicalIndicationsPatients={
                    currentModule === 'CENSUS' ? medicalIndicationsPatients : []
                  }
                />
              </React.Suspense>
            </div>
          )}
        </div>
        {trailingActions && (
          <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">{trailingActions}</div>
        )}
      </div>
    </div>
  );
};
