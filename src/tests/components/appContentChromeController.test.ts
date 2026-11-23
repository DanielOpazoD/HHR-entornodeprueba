import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDateStripProps,
  buildAppRouterShellState,
  buildNavbarProps,
  buildCensusQuickActionPatients,
  canUseCensusDateStripActions,
  resolveBookmarkToggleAction,
  resolveDateStripCensusActions,
} from '@/components/layout/app-content/appContentChromeController';
import type { AppContentRuntime } from '@/components/layout/app-content/useAppContentRuntime';
import { buildAuthContextValue, type AuthContextType } from '@/context/authContextController';
import type { UseCensusEmailReturn } from '@/context/CensusContext';
import type { UseExportManagerReturn } from '@/hooks/useExportManager';
import type { UseModalReturn } from '@/hooks/useModal';
import type { UseUIStateReturn } from '@/hooks/useUIState';
import { resolveNormalizedAuthOperationalState } from '@/services/auth/authOperationalState';
import type { UserRole } from '@/types/authRoleTypes';
import { DataFactory } from '@/tests/factories/DataFactory';

const createModalState = (overrides: Partial<UseModalReturn> = {}): UseModalReturn => ({
  isOpen: false,
  data: null,
  open: vi.fn(),
  close: vi.fn(),
  toggle: vi.fn(),
  ...overrides,
});

const createCensusEmail = (
  overrides: Partial<UseCensusEmailReturn> = {}
): UseCensusEmailReturn => ({
  showEmailConfig: false,
  setShowEmailConfig: vi.fn(),
  recipients: [],
  setRecipients: vi.fn(),
  recipientLists: [],
  activeRecipientListId: 'default',
  setActiveRecipientListId: vi.fn(),
  createRecipientList: vi.fn().mockResolvedValue(undefined),
  renameActiveRecipientList: vi.fn().mockResolvedValue(undefined),
  deleteRecipientList: vi.fn().mockResolvedValue(undefined),
  recipientsSource: 'default',
  isRecipientsSyncing: false,
  recipientsSyncError: null,
  message: '',
  onMessageChange: vi.fn(),
  onResetMessage: vi.fn(),
  status: 'idle',
  error: null,
  resetStatus: vi.fn(),
  sendEmail: vi.fn().mockResolvedValue(undefined),
  testModeEnabled: false,
  setTestModeEnabled: vi.fn(),
  testRecipient: '',
  setTestRecipient: vi.fn(),
  isAdminUser: false,
  ...overrides,
});

const createExportManager = (
  overrides: Partial<UseExportManagerReturn> = {}
): UseExportManagerReturn => ({
  isArchived: false,
  isBackingUp: false,
  handleExportPDF: vi.fn().mockResolvedValue(undefined),
  handlePrintWithBrowserOptions: vi.fn().mockResolvedValue(undefined),
  handleBackupExcel: vi.fn().mockResolvedValue(undefined),
  handleBackupHandoff: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const createAuth = (
  overrides: {
    role?: UserRole;
    email?: string;
    isFirebaseConnected?: boolean;
    signOut?: AuthContextType['signOut'];
  } = {}
): AuthContextType =>
  buildAuthContextValue(
    resolveNormalizedAuthOperationalState({
      currentUser: {
        uid: 'test-user',
        email: overrides.email ?? 'admin@hospital.cl',
        displayName: 'Test User',
        role: overrides.role ?? 'admin',
      },
      role: overrides.role ?? 'admin',
      isFirebaseConnected: overrides.isFirebaseConnected ?? true,
      handleLogout: overrides.signOut ?? vi.fn().mockResolvedValue(undefined),
    })
  );

const createDateNav = (
  overrides: Partial<AppContentRuntime['dateNav']> = {}
): AppContentRuntime['dateNav'] => ({
  selectedYear: 2026,
  setSelectedYear: vi.fn(),
  selectedMonth: 3,
  setSelectedMonth: vi.fn(),
  selectedDay: 22,
  setSelectedDay: vi.fn(),
  currentDateString: '2026-04-22',
  daysInMonth: 30,
  existingDaysInMonth: [18, 19, 22],
  clinicalToday: '2026-04-22',
  goToClinicalToday: vi.fn(),
  navigateDays: vi.fn(),
  ...overrides,
});

const createFileOps = (
  overrides: Partial<AppContentRuntime['fileOps']> = {}
): AppContentRuntime['fileOps'] => ({
  handleExportJSON: vi.fn(),
  handleExportCSV: vi.fn(),
  handleImportJSON: vi.fn().mockResolvedValue(undefined),
  handleImportFile: vi.fn().mockResolvedValue(undefined),
  error: null,
  clearError: vi.fn(),
  ...overrides,
});

const createChromeUi = (overrides: Partial<UseUIStateReturn> = {}): UseUIStateReturn => ({
  currentModule: 'CENSUS',
  setCurrentModule: vi.fn(),
  censusViewMode: 'REGISTER',
  setCensusViewMode: vi.fn(),
  bedManagerModal: createModalState(),
  patientSearchModal: createModalState(),
  isTestAgentRunning: false,
  setIsTestAgentRunning: vi.fn(),
  selectedShift: 'day',
  setSelectedShift: vi.fn(),
  showPrintButton: true,
  showBookmarksBar: true,
  setShowBookmarksBar: vi.fn(),
  ...overrides,
});

type DateStripRuntime = Parameters<typeof buildDateStripProps>[0]['runtime'];

const createDateStripRuntime = (overrides: Partial<DateStripRuntime> = {}): DateStripRuntime => ({
  auth: createAuth({ role: 'admin' }),
  dateNav: createDateNav(),
  censusEmail: createCensusEmail(),
  syncStatus: 'saved',
  lastSyncTime: new Date('2026-04-22T08:00:00.000Z'),
  exportManager: createExportManager(),
  canUseCensusExports: true,
  handleExportExcel: vi.fn().mockResolvedValue(undefined),
  censusAccessProfile: 'default',
  ...overrides,
});

describe('appContentChromeController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T10:00:00.000Z'));
  });

  it('offers the quick actions only the occupied beds', () => {
    const result = buildCensusQuickActionPatients(
      DataFactory.createMockDailyRecord('2026-04-22', {
        beds: {
          R1: DataFactory.createMockPatient('R1', {
            patientName: 'Ana Test',
            rut: '1-9',
            cie10Description: 'Diagnostico A',
            age: '34a',
            birthDate: '1991-04-02',
            admissionDate: '2026-04-20',
          }),
          R2: DataFactory.createMockPatient('R2', {
            patientName: '   ',
          }),
        },
      })
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      bedId: 'R1',
      patientName: 'Ana Test',
      diagnosis: 'Diagnostico A',
      birthDate: '02-04-1991',
      admissionDate: '20-04-2026',
    });
  });

  it('enables census date strip actions only on census with export access', () => {
    expect(canUseCensusDateStripActions('CENSUS', true)).toBe(true);
    expect(canUseCensusDateStripActions('CENSUS', false)).toBe(false);
    expect(canUseCensusDateStripActions('NURSING_HANDOFF', true)).toBe(false);
  });

  it('builds enabled census actions when the user can export', async () => {
    const setShowEmailConfig = vi.fn();
    const handleBackupExcel = vi.fn().mockResolvedValue(undefined);
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const handleExportExcel = vi.fn().mockResolvedValue(undefined);

    const actions = resolveDateStripCensusActions({
      canUseCensusActions: true,
      censusEmail: createCensusEmail({
        setShowEmailConfig,
        sendEmail,
      }),
      exportManager: createExportManager({
        handleBackupExcel,
      }),
      handleExportExcel,
    });

    actions.onConfigureEmail?.();
    actions.onExportExcel?.();
    await actions.onSendEmail?.();

    expect(setShowEmailConfig).toHaveBeenCalledWith(true);
    expect(handleExportExcel).toHaveBeenCalledTimes(1);
    expect(handleBackupExcel).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(actions.onBackupExcel).toBe(handleBackupExcel);
  });

  it('returns no-op actions as undefined when census exports are unavailable', () => {
    const actions = resolveDateStripCensusActions({
      canUseCensusActions: false,
      censusEmail: createCensusEmail(),
      exportManager: createExportManager(),
      handleExportExcel: vi.fn().mockResolvedValue(undefined),
    });

    expect(actions).toEqual({
      onExportExcel: undefined,
      onConfigureEmail: undefined,
      onSendEmail: undefined,
      onBackupExcel: undefined,
    });
  });

  it('builds the bookmark toggle action only when it is allowed', () => {
    const setShowBookmarksBar = vi.fn();
    const toggle = resolveBookmarkToggleAction({
      canShowBookmarkToggle: true,
      showBookmarksBar: true,
      setShowBookmarksBar,
    });

    toggle?.();
    expect(setShowBookmarksBar).toHaveBeenCalledWith(false);

    expect(
      resolveBookmarkToggleAction({
        canShowBookmarkToggle: false,
        showBookmarksBar: true,
        setShowBookmarksBar,
      })
    ).toBeUndefined();
  });

  it('builds census DateStrip props from ui and runtime state', () => {
    const ui = createChromeUi({
      currentModule: 'CENSUS',
      censusViewMode: 'REGISTER',
      showPrintButton: true,
      showBookmarksBar: true,
    });

    const runtime = createDateStripRuntime({
      auth: createAuth({ role: 'admin' }),
      censusAccessProfile: 'default',
    });

    const props = buildDateStripProps({
      ui,
      runtime,
      censusQuickActionPatients: [],
    });

    expect(props).toMatchObject({
      currentModule: 'CENSUS',
      currentDateString: '2026-04-22',
      onOpenBedManager: ui.bedManagerModal.open,
      onExportExcel: runtime.handleExportExcel,
      onBackupExcel: runtime.exportManager.handleBackupExcel,
      onBackupPDF: runtime.exportManager.handleBackupHandoff,
      accessProfile: 'default',
      showBookmarks: true,
      role: 'admin',
      onOpenPatientSearch: ui.patientSearchModal.open,
    });
    expect(props.onToggleBookmarks).toEqual(expect.any(Function));
  });

  it('builds Navbar props from ui and runtime state', () => {
    const ui = createChromeUi({
      currentModule: 'CENSUS',
      censusViewMode: 'REGISTER',
    });
    const runtime = {
      auth: createAuth({
        email: 'admin@hospital.cl',
        isFirebaseConnected: true,
      }),
      fileOps: createFileOps(),
    };

    expect(buildNavbarProps({ ui, runtime })).toMatchObject({
      currentModule: 'CENSUS',
      setModule: ui.setCurrentModule,
      censusViewMode: 'REGISTER',
      setCensusViewMode: ui.setCensusViewMode,
      onOpenBedManager: ui.bedManagerModal.open,
      onExportCSV: runtime.fileOps.handleExportCSV,
      onImportJSON: runtime.fileOps.handleImportJSON,
      userEmail: 'admin@hospital.cl',
      onLogout: runtime.auth.signOut,
      isFirebaseConnected: true,
    });
  });

  it('builds AppRouter shell state from the chrome runtime boundary', () => {
    const closeBedManager = vi.fn();
    const onOpenCensusDate = vi.fn();

    const shellState = buildAppRouterShellState({
      ui: {
        bedManagerModal: createModalState({
          isOpen: true,
          close: closeBedManager,
        }),
      },
      runtime: {
        auth: createAuth({
          role: 'doctor_urgency',
        }),
        dateNav: createDateNav({
          selectedDay: 23,
          selectedMonth: 3,
          currentDateString: '2026-04-23',
        }),
      },
      onOpenCensusDate,
    });

    expect(shellState).toEqual({
      selectedDay: 23,
      selectedMonth: 3,
      currentDateString: '2026-04-23',
      role: 'doctor_urgency',
      showBedManagerModal: true,
      onCloseBedManagerModal: closeBedManager,
      onOpenCensusDate,
    });
  });

  it('removes census-only DateStrip actions for non-census modules', () => {
    const props = buildDateStripProps({
      ui: createChromeUi({
        currentModule: 'CUDYR',
        censusViewMode: 'REGISTER',
        showPrintButton: false,
        showBookmarksBar: false,
      }),
      runtime: createDateStripRuntime({
        auth: createAuth({ role: 'doctor_urgency' }),
        dateNav: createDateNav({ existingDaysInMonth: [] }),
        syncStatus: 'idle',
        lastSyncTime: null,
        censusAccessProfile: 'default',
      }),
      censusQuickActionPatients: [],
    });

    expect(props.onOpenBedManager).toBeUndefined();
    expect(props.onExportExcel).toBeUndefined();
    expect(props.onConfigureEmail).toBeUndefined();
    expect(props.onSendEmail).toBeUndefined();
    expect(props.onBackupExcel).toBeUndefined();
    expect(props.onToggleBookmarks).toBeUndefined();
  });

  it('exposes configurable browser printing only for nursing handoff', () => {
    const handlePrintWithBrowserOptions = vi.fn().mockResolvedValue(undefined);
    const baseRuntime = createDateStripRuntime({
      auth: createAuth({ role: 'nurse_hospital' }),
      dateNav: createDateNav({
        selectedMonth: 6,
        selectedDay: 3,
        currentDateString: '2026-07-03',
        daysInMonth: 31,
        existingDaysInMonth: [3],
      }),
      lastSyncTime: null,
      exportManager: createExportManager({
        handlePrintWithBrowserOptions,
      }),
    });
    const baseUi = createChromeUi({
      showPrintButton: true,
      showBookmarksBar: false,
    });

    const nursingProps = buildDateStripProps({
      ui: { ...baseUi, currentModule: 'NURSING_HANDOFF' },
      runtime: baseRuntime,
      censusQuickActionPatients: [],
    });
    const censusProps = buildDateStripProps({
      ui: { ...baseUi, currentModule: 'CENSUS' },
      runtime: baseRuntime,
      censusQuickActionPatients: [],
    });

    expect(nursingProps.onPrintWithBrowserOptions).toBe(handlePrintWithBrowserOptions);
    expect(censusProps.onPrintWithBrowserOptions).toBeUndefined();
  });
});
