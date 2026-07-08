import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDateStripProps,
  buildAppRouterShellState,
  buildNavbarProps,
  buildMedicalIndicationsPatientOptions,
  canUseCensusDateStripActions,
  resolveBookmarkToggleAction,
  resolveDateStripCensusActions,
} from '@/components/layout/app-content/appContentChromeController';

describe('appContentChromeController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T10:00:00.000Z'));
  });

  it('builds medical indication options only for occupied beds', () => {
    const result = buildMedicalIndicationsPatientOptions({
      beds: {
        R1: {
          patientName: 'Ana Test',
          rut: '1-9',
          cie10Description: 'Diagnostico A',
          age: '34a',
          birthDate: '1991-04-02',
          admissionDate: '2026-04-20',
        },
        R2: {
          patientName: '   ',
        },
      },
    } as never);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      bedId: 'R1',
      patientName: 'Ana Test',
      diagnosis: 'Diagnostico A',
      daysOfStay: '3',
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
    const handleExportExcel = vi.fn();

    const actions = resolveDateStripCensusActions({
      canUseCensusActions: true,
      censusEmail: {
        setShowEmailConfig,
        sendEmail,
      } as never,
      exportManager: {
        handleBackupExcel,
      } as never,
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
      censusEmail: {} as never,
      exportManager: {} as never,
      handleExportExcel: vi.fn(),
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
    const ui = {
      currentModule: 'CENSUS',
      censusViewMode: 'REGISTER',
      showPrintButton: true,
      showBookmarksBar: true,
      setShowBookmarksBar: vi.fn(),
      bedManagerModal: { open: vi.fn() },
      patientSearchModal: { open: vi.fn() },
    };

    const runtime = {
      auth: { role: 'admin' },
      dateNav: {
        selectedYear: 2026,
        setSelectedYear: vi.fn(),
        selectedMonth: 3,
        setSelectedMonth: vi.fn(),
        selectedDay: 22,
        setSelectedDay: vi.fn(),
        currentDateString: '2026-04-22',
        daysInMonth: 30,
        existingDaysInMonth: [18, 19, 22],
        navigateDays: vi.fn(),
      },
      censusEmail: {
        status: 'idle',
        error: null,
        setShowEmailConfig: vi.fn(),
        sendEmail: vi.fn(),
      },
      syncStatus: 'saved',
      lastSyncTime: new Date('2026-04-22T08:00:00.000Z'),
      exportManager: {
        handleExportPDF: vi.fn(),
        handleBackupExcel: vi.fn(),
        handleBackupHandoff: vi.fn(),
        isArchived: false,
        isBackingUp: false,
      },
      canUseCensusExports: true,
      handleExportExcel: vi.fn(),
      censusAccessProfile: 'full',
    };

    const props = buildDateStripProps({
      ui: ui as never,
      runtime: runtime as never,
      medicalIndicationsPatients: [],
    });

    expect(props).toMatchObject({
      currentModule: 'CENSUS',
      currentDateString: '2026-04-22',
      onOpenBedManager: ui.bedManagerModal.open,
      onExportExcel: runtime.handleExportExcel,
      onBackupExcel: runtime.exportManager.handleBackupExcel,
      onBackupPDF: runtime.exportManager.handleBackupHandoff,
      accessProfile: 'full',
      showBookmarks: true,
      role: 'admin',
      onOpenPatientSearch: ui.patientSearchModal.open,
    });
    expect(props.onToggleBookmarks).toEqual(expect.any(Function));
  });

  it('builds Navbar props from ui and runtime state', () => {
    const ui = {
      currentModule: 'CENSUS',
      setCurrentModule: vi.fn(),
      censusViewMode: 'REGISTER',
      setCensusViewMode: vi.fn(),
      bedManagerModal: { open: vi.fn() },
    };
    const runtime = {
      auth: {
        currentUser: { email: 'admin@hospital.cl' },
        signOut: vi.fn(),
        isFirebaseConnected: true,
      },
      fileOps: {
        handleExportCSV: vi.fn(),
        handleImportJSON: vi.fn(),
      },
    };

    expect(buildNavbarProps({ ui: ui as never, runtime: runtime as never })).toMatchObject({
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
        bedManagerModal: {
          isOpen: true,
          close: closeBedManager,
        },
      } as never,
      runtime: {
        auth: {
          role: 'doctor',
        },
        dateNav: {
          selectedDay: 23,
          selectedMonth: 3,
          currentDateString: '2026-04-23',
          isSignatureMode: false,
        },
      } as never,
      onOpenCensusDate,
    });

    expect(shellState).toEqual({
      selectedDay: 23,
      selectedMonth: 3,
      currentDateString: '2026-04-23',
      role: 'doctor',
      isSignatureMode: false,
      showBedManagerModal: true,
      onCloseBedManagerModal: closeBedManager,
      onOpenCensusDate,
    });
  });

  it('removes census-only DateStrip actions for non-census modules', () => {
    const props = buildDateStripProps({
      ui: {
        currentModule: 'CUDYR',
        censusViewMode: 'REGISTER',
        showPrintButton: false,
        showBookmarksBar: false,
        setShowBookmarksBar: vi.fn(),
        bedManagerModal: { open: vi.fn() },
        patientSearchModal: { open: vi.fn() },
      } as never,
      runtime: {
        auth: { role: 'doctor' },
        dateNav: {
          selectedYear: 2026,
          setSelectedYear: vi.fn(),
          selectedMonth: 3,
          setSelectedMonth: vi.fn(),
          selectedDay: 22,
          setSelectedDay: vi.fn(),
          currentDateString: '2026-04-22',
          daysInMonth: 30,
          existingDaysInMonth: [],
          navigateDays: vi.fn(),
        },
        censusEmail: {
          status: 'idle',
          error: null,
          setShowEmailConfig: vi.fn(),
          sendEmail: vi.fn(),
        },
        syncStatus: 'idle',
        lastSyncTime: null,
        exportManager: {
          handleExportPDF: vi.fn(),
          handleBackupExcel: vi.fn(),
          handleBackupHandoff: vi.fn(),
          isArchived: false,
          isBackingUp: false,
        },
        canUseCensusExports: true,
        handleExportExcel: vi.fn(),
        censusAccessProfile: 'default',
      } as never,
      medicalIndicationsPatients: [],
    });

    expect(props.onOpenBedManager).toBeUndefined();
    expect(props.onExportExcel).toBeUndefined();
    expect(props.onConfigureEmail).toBeUndefined();
    expect(props.onSendEmail).toBeUndefined();
    expect(props.onBackupExcel).toBeUndefined();
    expect(props.onToggleBookmarks).toBeUndefined();
  });

  it('exposes configurable browser printing only for nursing handoff', () => {
    const handlePrintWithBrowserOptions = vi.fn();
    const baseRuntime = {
      auth: { role: 'nurse' },
      dateNav: {
        selectedYear: 2026,
        setSelectedYear: vi.fn(),
        selectedMonth: 6,
        setSelectedMonth: vi.fn(),
        selectedDay: 3,
        setSelectedDay: vi.fn(),
        currentDateString: '2026-07-03',
        daysInMonth: 31,
        existingDaysInMonth: [3],
        navigateDays: vi.fn(),
      },
      censusEmail: {
        status: 'idle',
        error: null,
        setShowEmailConfig: vi.fn(),
        sendEmail: vi.fn(),
      },
      syncStatus: 'saved',
      lastSyncTime: null,
      exportManager: {
        handleExportPDF: vi.fn(),
        handlePrintWithBrowserOptions,
        handleBackupExcel: vi.fn(),
        handleBackupHandoff: vi.fn(),
        isArchived: false,
        isBackingUp: false,
      },
      canUseCensusExports: true,
      handleExportExcel: vi.fn(),
      censusAccessProfile: 'default',
    };
    const baseUi = {
      censusViewMode: 'REGISTER',
      showPrintButton: true,
      showBookmarksBar: false,
      setShowBookmarksBar: vi.fn(),
      bedManagerModal: { open: vi.fn() },
      patientSearchModal: { open: vi.fn() },
    };

    const nursingProps = buildDateStripProps({
      ui: { ...baseUi, currentModule: 'NURSING_HANDOFF' } as never,
      runtime: baseRuntime as never,
      medicalIndicationsPatients: [],
    });
    const censusProps = buildDateStripProps({
      ui: { ...baseUi, currentModule: 'CENSUS' } as never,
      runtime: baseRuntime as never,
      medicalIndicationsPatients: [],
    });

    expect(nursingProps.onPrintWithBrowserOptions).toBe(handlePrintWithBrowserOptions);
    expect(censusProps.onPrintWithBrowserOptions).toBeUndefined();
  });
});
