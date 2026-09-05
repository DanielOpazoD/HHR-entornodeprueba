import type { ReactNode } from 'react';
import { BEDS } from '@/constants/beds';
import { formatDateToCL } from '@/utils/clinicalUtils';
import type { NavbarProps } from '@/components/layout/Navbar';
import type { AppRouterShellState } from '@/components/app-router/appRouterController';
import { shouldShowBookmarkToggle } from '@/components/layout/app-content/appContentVisibilityController';
import type { DateStripProps } from '@/components/layout/DateStrip';
import type { UseUIStateReturn } from '@/hooks/useUIState';
import type { AppContentRuntime } from '@/components/layout/app-content/useAppContentRuntime';
import type { MedicalIndicationsPatientOption } from '@/shared/contracts/medicalIndications';

interface MedicalIndicationsPatientSourceExtras {
  admissionTime?: string;
  clinicalEpisodeId?: string;
}

const calculateDaysOfStay = (admissionDate?: string): string => {
  if (!admissionDate) return '';
  const parsed = new Date(formatDateToCL(admissionDate).split('-').reverse().join('-'));
  if (Number.isNaN(parsed.getTime())) return '';
  const now = new Date();
  const days = Math.ceil((now.getTime() - parsed.getTime()) / (1000 * 60 * 60 * 24));
  return String(Math.max(days, 1));
};

export const buildMedicalIndicationsPatientOptions = (
  record: AppContentRuntime['record']
): MedicalIndicationsPatientOption[] => {
  const bedsById = new Map(BEDS.map(bed => [bed.id, bed]));

  return Object.entries(record?.beds || {})
    .filter(([, patient]) => Boolean(patient.patientName?.trim()))
    .map(([bedId, patient]) => {
      const extras = patient as MedicalIndicationsPatientSourceExtras;
      return {
        bedId,
        label: `${bedsById.get(bedId)?.name || bedId} · ${patient.patientName}`,
        patientName: patient.patientName || '',
        rut: patient.rut || '',
        diagnosis: patient.cie10Description || patient.pathology || '',
        age: patient.age || '',
        birthDate: formatDateToCL(patient.birthDate || ''),
        allergies: '',
        admissionDate: formatDateToCL(patient.admissionDate || ''),
        admissionTime: extras.admissionTime,
        clinicalEpisodeId: extras.clinicalEpisodeId,
        sourceDailyRecordDate: record?.date,
        daysOfStay: calculateDaysOfStay(patient.admissionDate),
        treatingDoctor: '',
      };
    });
};

export const canUseCensusDateStripActions = (
  currentModule: UseUIStateReturn['currentModule'],
  canUseCensusExports: boolean
) => currentModule === 'CENSUS' && canUseCensusExports;

export const resolveDateStripCensusActions = ({
  canUseCensusActions,
  censusEmail,
  exportManager,
  handleExportExcel,
}: {
  canUseCensusActions: boolean;
  censusEmail: AppContentRuntime['censusEmail'];
  exportManager: AppContentRuntime['exportManager'];
  handleExportExcel: AppContentRuntime['handleExportExcel'];
}) => ({
  onExportExcel: canUseCensusActions ? handleExportExcel : undefined,
  onConfigureEmail: canUseCensusActions ? () => censusEmail.setShowEmailConfig(true) : undefined,
  onSendEmail: canUseCensusActions
    ? async () => {
        await exportManager.handleBackupExcel();
        await censusEmail.sendEmail();
      }
    : undefined,
  onBackupExcel: canUseCensusActions ? exportManager.handleBackupExcel : undefined,
});

export const resolveBookmarkToggleAction = ({
  canShowBookmarkToggle,
  showBookmarksBar,
  setShowBookmarksBar,
}: {
  canShowBookmarkToggle: boolean;
  showBookmarksBar: boolean;
  setShowBookmarksBar: UseUIStateReturn['setShowBookmarksBar'];
}) => (canShowBookmarkToggle ? () => setShowBookmarksBar(!showBookmarksBar) : undefined);

export const buildNavbarProps = ({
  ui,
  runtime,
}: {
  ui: Pick<
    UseUIStateReturn,
    | 'currentModule'
    | 'setCurrentModule'
    | 'censusViewMode'
    | 'setCensusViewMode'
    | 'bedManagerModal'
  >;
  runtime: Pick<AppContentRuntime, 'auth' | 'fileOps'>;
}): NavbarProps => ({
  currentModule: ui.currentModule,
  setModule: ui.setCurrentModule,
  censusViewMode: ui.censusViewMode,
  setCensusViewMode: ui.setCensusViewMode,
  onOpenBedManager: ui.bedManagerModal.open,
  onExportCSV: runtime.fileOps.handleExportCSV,
  onImportJSON: runtime.fileOps.handleImportJSON,
  userEmail: runtime.auth.currentUser?.email,
  onLogout: runtime.auth.signOut,
  isFirebaseConnected: runtime.auth.isFirebaseConnected,
});

export const buildAppRouterShellState = ({
  ui,
  runtime,
  onOpenCensusDate,
}: {
  ui: Pick<UseUIStateReturn, 'bedManagerModal'>;
  runtime: Pick<AppContentRuntime, 'auth' | 'dateNav'>;
  onOpenCensusDate?: (date: string) => void;
}): AppRouterShellState => ({
  selectedDay: runtime.dateNav.selectedDay,
  selectedMonth: runtime.dateNav.selectedMonth,
  currentDateString: runtime.dateNav.currentDateString,
  role: runtime.auth.role,
  isSignatureMode: runtime.dateNav.isSignatureMode,
  showBedManagerModal: ui.bedManagerModal.isOpen,
  onCloseBedManagerModal: ui.bedManagerModal.close,
  onOpenCensusDate,
});

export const buildDateStripProps = ({
  ui,
  runtime,
  medicalIndicationsPatients,
  renderFeatureQuickActions,
}: {
  ui: Pick<
    UseUIStateReturn,
    | 'currentModule'
    | 'censusViewMode'
    | 'showPrintButton'
    | 'showBookmarksBar'
    | 'setShowBookmarksBar'
    | 'bedManagerModal'
    | 'patientSearchModal'
  >;
  runtime: Pick<
    AppContentRuntime,
    | 'auth'
    | 'dateNav'
    | 'censusEmail'
    | 'syncStatus'
    | 'lastSyncTime'
    | 'exportManager'
    | 'canUseCensusExports'
    | 'handleExportExcel'
    | 'censusAccessProfile'
  >;
  medicalIndicationsPatients: MedicalIndicationsPatientOption[];
  renderFeatureQuickActions?: (patients: MedicalIndicationsPatientOption[]) => ReactNode;
}): DateStripProps => {
  const canUseCensusActions = canUseCensusDateStripActions(
    ui.currentModule,
    runtime.canUseCensusExports
  );
  const dateStripCensusActions = resolveDateStripCensusActions({
    canUseCensusActions,
    censusEmail: runtime.censusEmail,
    exportManager: runtime.exportManager,
    handleExportExcel: runtime.handleExportExcel,
  });

  return {
    selectedYear: runtime.dateNav.selectedYear,
    setSelectedYear: runtime.dateNav.setSelectedYear,
    selectedMonth: runtime.dateNav.selectedMonth,
    setSelectedMonth: runtime.dateNav.setSelectedMonth,
    selectedDay: runtime.dateNav.selectedDay,
    setSelectedDay: runtime.dateNav.setSelectedDay,
    currentDateString: runtime.dateNav.currentDateString,
    clinicalToday: runtime.dateNav.clinicalToday,
    goToClinicalToday: runtime.dateNav.goToClinicalToday,
    daysInMonth: runtime.dateNav.daysInMonth,
    existingDaysInMonth: runtime.dateNav.existingDaysInMonth,
    onExportPDF: ui.showPrintButton ? runtime.exportManager.handleExportPDF : undefined,
    onPrintWithBrowserOptions:
      ui.currentModule === 'NURSING_HANDOFF'
        ? runtime.exportManager.handlePrintWithBrowserOptions
        : undefined,
    onOpenBedManager: ui.currentModule === 'CENSUS' ? ui.bedManagerModal.open : undefined,
    onExportExcel: dateStripCensusActions.onExportExcel,
    onConfigureEmail: dateStripCensusActions.onConfigureEmail,
    onSendEmail: dateStripCensusActions.onSendEmail,
    onBackupExcel: dateStripCensusActions.onBackupExcel,
    isArchived: runtime.exportManager.isArchived,
    isBackingUp: runtime.exportManager.isBackingUp,
    currentModule: ui.currentModule,
    emailStatus: runtime.censusEmail.status,
    emailErrorMessage: runtime.censusEmail.error,
    emailBlockedReason: runtime.censusEmail.emailBlockedReason,
    syncStatus: runtime.syncStatus,
    lastSyncTime: runtime.lastSyncTime,
    onToggleBookmarks: resolveBookmarkToggleAction({
      canShowBookmarkToggle: shouldShowBookmarkToggle({
        currentModule: ui.currentModule,
        censusViewMode: ui.censusViewMode,
        role: runtime.auth.role,
      }),
      showBookmarksBar: ui.showBookmarksBar,
      setShowBookmarksBar: ui.setShowBookmarksBar,
    }),
    showBookmarks: ui.showBookmarksBar,
    role: runtime.auth.role,
    onBackupPDF: runtime.exportManager.handleBackupHandoff,
    navigateDays: runtime.dateNav.navigateDays,
    accessProfile: runtime.censusAccessProfile,
    medicalIndicationsPatients,
    renderFeatureQuickActions,
    onOpenPatientSearch: ui.patientSearchModal.open,
  };
};
