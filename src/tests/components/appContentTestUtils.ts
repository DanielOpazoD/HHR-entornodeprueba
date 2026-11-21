import React from 'react';
import { vi } from 'vitest';
import type { AppContentRuntime } from '@/components/layout/app-content/useAppContentRuntime';
import type { AuthContextType } from '@/context/AuthContext';
import { buildAuthContextValue } from '@/context/authContextController';
import type { CensusContextType } from '@/context/CensusContext';
import {
  unavailableReminderCenterValue,
  type ReminderCenterContextValue,
} from '@/context/reminderCenterContextContract';
import type { UseExportManagerReturn } from '@/hooks/useExportManager';
import type { UseModalReturn } from '@/hooks/useModal';
import type { UseUIStateReturn } from '@/hooks/useUIState';
import { resolveNormalizedAuthOperationalState } from '@/services/auth/authOperationalState';
import { resolveSpecialistCapabilities } from '@/shared/access/specialistAccessPolicy';

type LazyComponentProps = Record<string, unknown>;
type LazyComponent = React.ComponentType<LazyComponentProps>;

const pendingLazyLoads: Promise<void>[] = [];
const resolvedLazyComponents = new Map<symbol, LazyComponent>();

/**
 * Replaces `lazyWithRetry` with a synchronous test wrapper so suites testing shell
 * layout and overlay wiring do not duplicate React.lazy bypass boilerplate.
 */
export const createLazyWithRetryBypass = () => ({
  lazyWithRetry: (factory: () => Promise<{ default: LazyComponent }>) => {
    const key = Symbol();
    const pending = factory().then(module => {
      resolvedLazyComponents.set(key, module.default);
    });
    pendingLazyLoads.push(pending);
    return React.forwardRef(function LazyBypass(
      props: LazyComponentProps,
      ref: React.ForwardedRef<unknown>
    ) {
      const Component = resolvedLazyComponents.get(key) ?? null;
      return Component ? React.createElement(Component, { ...props, ref }) : null;
    });
  },
});

export const flushLazyBypassComponents = async (): Promise<void> => {
  await Promise.all(pendingLazyLoads);
};

export const createShellModalMock = (
  overrides: Partial<UseModalReturn<void>> = {}
): UseModalReturn<void> => ({
  isOpen: false,
  data: null,
  open: vi.fn(),
  close: vi.fn(),
  toggle: vi.fn(),
  ...overrides,
});

export const createShellUiMock = (overrides: Partial<UseUIStateReturn> = {}): UseUIStateReturn => ({
  currentModule: 'CENSUS',
  setCurrentModule: vi.fn(),
  censusViewMode: 'REGISTER',
  setCensusViewMode: vi.fn(),
  bedManagerModal: createShellModalMock(),
  patientSearchModal: createShellModalMock(),
  showPrintButton: true,
  showBookmarksBar: true,
  setShowBookmarksBar: vi.fn(),
  isTestAgentRunning: false,
  setIsTestAgentRunning: vi.fn(),
  selectedShift: 'day',
  setSelectedShift: vi.fn(),
  ...overrides,
});

export const createShellReminderCenterMock = (
  overrides: Partial<ReminderCenterContextValue> = {}
): ReminderCenterContextValue => ({
  ...unavailableReminderCenterValue,
  loading: false,
  openCenter: vi.fn(),
  closeCenter: vi.fn(),
  ...overrides,
});

export const createShellAuthMock = (overrides: Partial<AuthContextType> = {}): AuthContextType => {
  const role = overrides.role ?? 'admin';
  const defaultUser = {
    uid: 'synthetic-uid',
    email: 'admin@hospital.cl',
    displayName: 'Admin Sintético',
    role,
  };
  return {
    ...buildAuthContextValue(
      resolveNormalizedAuthOperationalState({
        currentUser: defaultUser,
        authorizedUser: defaultUser,
        role,
        isFirebaseConnected: true,
        isOnline: true,
        handleLogout: vi.fn(),
      })
    ),
    ...overrides,
  };
};

export const createShellDateNavMock = (
  overrides: Partial<CensusContextType['dateNav']> = {}
): CensusContextType['dateNav'] => ({
  selectedYear: 2026,
  setSelectedYear: vi.fn(),
  selectedMonth: 2,
  setSelectedMonth: vi.fn(),
  selectedDay: 27,
  setSelectedDay: vi.fn(),
  daysInMonth: 31,
  currentDateString: '2026-03-27',
  clinicalToday: '2026-03-27',
  goToClinicalToday: vi.fn(),
  existingDaysInMonth: [1, 4],
  navigateDays: vi.fn(),
  ...overrides,
});

export const createShellCensusEmailMock = (
  overrides: Partial<CensusContextType['censusEmail']> = {}
): CensusContextType['censusEmail'] => ({
  recipients: [],
  setRecipients: vi.fn(),
  recipientLists: [],
  activeRecipientListId: '',
  setActiveRecipientListId: vi.fn(),
  createRecipientList: vi.fn(),
  renameActiveRecipientList: vi.fn(),
  deleteRecipientList: vi.fn(),
  recipientsSource: 'local',
  isRecipientsSyncing: false,
  recipientsSyncError: null,
  message: '',
  onMessageChange: vi.fn(),
  onResetMessage: vi.fn(),
  status: 'idle',
  error: null,
  emailBlockedReason: null,
  resetStatus: vi.fn(),
  showEmailConfig: false,
  setShowEmailConfig: vi.fn(),
  sendEmail: vi.fn(),
  testModeEnabled: false,
  setTestModeEnabled: vi.fn(),
  testRecipient: '',
  setTestRecipient: vi.fn(),
  isAdminUser: true,
  ...overrides,
});

export const createShellExportManagerMock = (
  overrides: Partial<UseExportManagerReturn> = {}
): UseExportManagerReturn => ({
  isArchived: false,
  isBackingUp: false,
  handleExportPDF: vi.fn(),
  handlePrintWithBrowserOptions: vi.fn(),
  handleBackupExcel: vi.fn(),
  handleBackupHandoff: vi.fn(),
  ...overrides,
});

const createShellFileOpsMock = (): CensusContextType['fileOps'] => ({
  handleExportJSON: vi.fn(),
  handleExportCSV: vi.fn(),
  handleImportJSON: vi.fn(),
  handleImportFile: vi.fn(),
  error: null,
  clearError: vi.fn(),
});

export const createShellCensusContextMock = (
  overrides: Partial<CensusContextType> = {}
): CensusContextType => ({
  dailyRecord: {
    record: null,
    syncStatus: 'idle',
    lastSyncTime: null,
  } as CensusContextType['dailyRecord'],
  dateNav: createShellDateNavMock(),
  censusEmail: createShellCensusEmailMock(),
  fileOps: createShellFileOpsMock(),
  nurseSignature: 'Night Nurse',
  ...overrides,
});

export const createShellRuntimeMock = (
  overrides: Partial<AppContentRuntime> = {}
): AppContentRuntime => ({
  auth: createShellAuthMock(),
  dailyRecordHook: {
    record: null,
    syncStatus: 'idle',
    lastSyncTime: null,
  } as AppContentRuntime['dailyRecordHook'],
  record: null,
  syncStatus: 'idle',
  lastSyncTime: null,
  dateNav: createShellDateNavMock(),
  censusEmail: createShellCensusEmailMock(),
  fileOps: createShellFileOpsMock(),
  nurseSignature: 'Night Nurse',
  specialistCapabilities: resolveSpecialistCapabilities('admin'),
  censusAccessProfile: 'default',
  canUseCensusExports: true,
  canVerifyArchiveStatus: true,
  exportManager: createShellExportManagerMock(),
  handleExportExcel: vi.fn(),
  ...overrides,
});
