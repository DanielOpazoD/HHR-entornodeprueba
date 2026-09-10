import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CensusView } from '@/features/census/components/CensusView';

/**
 * Costura real del arranque desde Eloísa.
 *
 * Hasta aquí cada mitad se probaba con la otra sustituida: el prompt con un botón falso, el
 * botón de importación con un `autoStartRequestId` fijo. Ninguna prueba cruzaba el tramo que
 * falló en producción: EmptyDayPrompt → RayenDayBootstrapButton → estado de CensusView → cambio
 * de rama → CensusRegisterContent → CensusStaffHeader → RayenImportButton. Aquí ese tramo es
 * código real; sólo se sustituyen el modelo de pantalla, los contextos y la extensión.
 */

const CLINICAL_TODAY = '2026-09-10';

const mocks = vi.hoisted(() => ({
  screenModel: vi.fn(),
  dailyRecordData: vi.fn(),
  dailyRecordStatus: vi.fn(),
  triggerImport: vi.fn(),
  refreshHealth: vi.fn(),
  extensionHealth: vi.fn(),
  rayenImport: vi.fn(),
}));

vi.mock('@/features/census/hooks/useCensusViewScreenModel', () => ({
  useCensusViewScreenModel: () => mocks.screenModel(),
}));

vi.mock('@/context', () => ({
  useAuth: () => ({
    sessionState: { status: 'authorized', user: { uid: 'user-1' } },
    isAuthenticated: true,
    isFirebaseConnected: true,
    remoteSyncStatus: 'ready',
  }),
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => mocks.dailyRecordData(),
  useDailyRecordStatus: () => mocks.dailyRecordStatus(),
  useDailyRecordBeds: () => ({}),
  useDailyRecordStaff: () => ({
    nursesDayShift: [],
    nursesNightShift: [],
    tensDayShift: [],
    tensNightShift: [],
  }),
  useDailyRecordMovements: () => ({ discharges: [], transfers: [], cma: [] }),
}));

vi.mock('@/context/useDailyRecordScopedActions', () => ({
  useDailyRecordStaffActions: () => ({
    updateNurse: vi.fn(),
    updateTens: vi.fn(),
    updateDetailedStaffing: vi.fn(),
  }),
}));

vi.mock('@/context/StaffContext', () => ({
  useStaffContext: () => ({ nursesList: [], tensList: [] }),
}));

vi.mock('@/context/CensusContext', () => ({
  useCensusContext: () => ({
    dateNav: { clinicalToday: CLINICAL_TODAY, goToClinicalToday: () => {} },
  }),
}));

vi.mock('@/hooks/useClinicalToday', () => ({
  useClinicalToday: () => CLINICAL_TODAY,
}));

vi.mock('@/services/repositories/dailyRecordOperationalTelemetry', () => ({
  dailyRecordObservability: { recordEvent: vi.fn() },
}));

vi.mock('@/components/ui/ViewLoader', () => ({
  ViewLoader: () => <div data-testid="view-loader" />,
}));
vi.mock('@/components/shared/SectionErrorBoundary', () => ({
  SectionErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/features/census/components/CensusActionsContext', () => ({
  CensusActionsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/features/census/components/CensusPrintHeader', () => ({
  CensusPrintHeader: () => null,
}));
vi.mock('@/features/census/components/CensusRegisterMainContent', () => ({
  CensusRegisterMainContent: () => <div data-testid="census-table" />,
}));
vi.mock('@/features/census/components/CensusRegisterSections', () => ({
  CensusRegisterSections: () => null,
}));
vi.mock('@/features/census/components/NurseSelector', () => ({
  NurseSelector: () => <div data-testid="nurse-selector" />,
}));
vi.mock('@/features/census/components/TensSelector', () => ({
  TensSelector: () => <div data-testid="tens-selector" />,
}));
vi.mock('@/components/layout/SummaryCard', () => ({
  CombinedSummaryCard: () => null,
}));

vi.mock('@/features/rayen-import/hooks/useRayenExtensionHealth', () => ({
  useRayenExtensionHealth: () => mocks.extensionHealth(),
}));
vi.mock('@/features/rayen-import/hooks/useRayenImport', () => ({
  useRayenImport: () => mocks.rayenImport(),
}));
vi.mock('@/features/rayen-import/hooks/useRayenFillStatus', () => ({
  useRayenFillProgress: () => ({
    running: false,
    done: 0,
    total: 0,
    errors: 0,
    lastCompletedAt: null,
    outcome: null,
    attemptId: null,
    staffingOutcome: null,
  }),
}));
vi.mock('@/features/rayen-import/components/RayenImportPreviewModal', () => ({
  RayenImportPreviewModal: () => null,
}));

const readyHealth = {
  connection: 'ready',
  report: null,
  message: 'Extensión Eloísa v0.48.19 operativa.',
  canSync: true,
};

const importState = (overrides: Record<string, unknown> = {}) => ({
  mode: 'auto',
  policyStatus: 'ready',
  policyBlockReason: null,
  execution: null,
  diff: null,
  isPreviewOpen: false,
  result: null,
  error: null,
  staffingProposal: null,
  isStaffingProposalBusy: false,
  staffingProposalError: null,
  triggerImport: mocks.triggerImport,
  retryClinicalFill: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  confirmStaffingProposal: vi.fn(),
  dismissStaffingProposal: vi.fn(),
  ...overrides,
});

/** Mutable census world: a blank census day that only exists after `createDay` resolves. */
const createCensusWorld = () => {
  const world = { hasRecord: false, createDayCalls: [] as unknown[][] };
  const registerContentProps = {
    currentDateString: CLINICAL_TODAY,
    readOnly: false,
    beds: {},
    visibleBeds: [],
    marginStyle: {},
    stats: null,
    showBedManagerModal: false,
    onCloseBedManagerModal: vi.fn(),
  };
  mocks.screenModel.mockImplementation(() =>
    world.hasRecord
      ? {
          branch: 'register',
          emptyDayPromptProps: null,
          registerContentProps,
          shouldDeferTodayEmptyState: false,
          resolvedTodayEmptyDate: CLINICAL_TODAY,
        }
      : {
          branch: 'empty',
          emptyDayPromptProps: {
            selectedDay: 10,
            selectedMonth: 8,
            currentDateString: CLINICAL_TODAY,
            previousRecordAvailable: false,
            onCreateDay: async (...args: unknown[]) => {
              world.createDayCalls.push(args);
              world.hasRecord = true;
            },
          },
          registerContentProps: null,
          shouldDeferTodayEmptyState: false,
          resolvedTodayEmptyDate: CLINICAL_TODAY,
        }
  );
  mocks.dailyRecordData.mockImplementation(() => ({
    bootstrapPhase: world.hasRecord ? 'record_ready' : 'confirmed_empty',
    record: world.hasRecord ? { date: CLINICAL_TODAY, beds: {} } : null,
  }));
  return world;
};

const censusElement = () => (
  <CensusView
    selectedDay={10}
    selectedMonth={8}
    currentDateString={CLINICAL_TODAY}
    showBedManagerModal={false}
    onCloseBedManagerModal={vi.fn()}
  />
);
const renderCensus = () => render(censusElement());

describe('Crear desde Eloísa · costura CensusView → RayenImportButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dailyRecordStatus.mockReturnValue({
      bootstrapPhase: 'confirmed_empty',
      syncStatus: 'idle',
      lastSyncTime: null,
      isInitialRemoteHydrationPending: false,
      isSaving: false,
      hasError: false,
      isIdle: true,
      isSaved: false,
    });
    mocks.refreshHealth.mockResolvedValue(readyHealth);
    mocks.extensionHealth.mockReturnValue({ ...readyHealth, refresh: mocks.refreshHealth });
    mocks.rayenImport.mockReturnValue(importState());
    mocks.triggerImport.mockResolvedValue('started');
  });

  it('creates the blank day and starts exactly one reviewed import through the real chain', async () => {
    const world = createCensusWorld();
    renderCensus();

    const bootstrapButton = await screen.findByTestId(
      'create-from-rayen-btn',
      {},
      { timeout: 3000 }
    );
    await act(async () => {
      fireEvent.click(bootstrapButton);
    });

    // The empty branch is gone and the real toolbar took over.
    await waitFor(() => expect(screen.getByTestId('rayen-operations-bar')).toBeInTheDocument());
    expect(world.createDayCalls).toEqual([[false]]);
    expect(screen.queryByTestId('create-from-rayen-btn')).not.toBeInTheDocument();

    // The intent crossed the seam once and carries the human-review requirement.
    await waitFor(() => expect(mocks.triggerImport).toHaveBeenCalledTimes(1));
    expect(mocks.triggerImport).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      reviewRequirement: 'day_bootstrap',
    });
    // Health was checked twice on purpose: once before creating the day, once as import preflight.
    expect(mocks.refreshHealth).toHaveBeenCalledTimes(2);
  });

  it('does not create the day when the extension cannot sync', async () => {
    const world = createCensusWorld();
    const downHealth = {
      connection: 'offline',
      report: null,
      message: 'Ficha Médico no está abierta.',
      canSync: false,
    };
    mocks.refreshHealth.mockResolvedValue(downHealth);
    mocks.extensionHealth.mockReturnValue({ ...downHealth, refresh: mocks.refreshHealth });
    renderCensus();

    const bootstrapButton = await screen.findByTestId(
      'create-from-rayen-btn',
      {},
      { timeout: 3000 }
    );
    await act(async () => {
      fireEvent.click(bootstrapButton);
    });

    await waitFor(() =>
      expect(screen.getByText('Ficha Médico no está abierta.')).toBeInTheDocument()
    );
    expect(world.createDayCalls).toEqual([]);
    expect(mocks.triggerImport).not.toHaveBeenCalled();
    expect(screen.getByTestId('create-from-rayen-btn')).toBeInTheDocument();
  });

  it('keeps the intent alive across a blocked capture and starts once the blocker clears', async () => {
    createCensusWorld();
    mocks.triggerImport.mockResolvedValueOnce('blocked').mockResolvedValue('started');
    const view = renderCensus();

    const bootstrapButton = await screen.findByTestId(
      'create-from-rayen-btn',
      {},
      { timeout: 3000 }
    );
    await act(async () => {
      fireEvent.click(bootstrapButton);
    });
    await waitFor(() => expect(mocks.triggerImport).toHaveBeenCalledTimes(1));

    // A blocked attempt leaves no run behind, so CensusView must still hold the request. When the
    // import hook re-publishes (e.g. the census finished loading), the same request fires again.
    const retriedTrigger = vi.fn().mockResolvedValue('started');
    mocks.rayenImport.mockReturnValue(importState({ triggerImport: retriedTrigger }));
    await act(async () => {
      view.rerender(censusElement());
    });

    await waitFor(() => expect(retriedTrigger).toHaveBeenCalledTimes(1));
    expect(retriedTrigger).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      reviewRequirement: 'day_bootstrap',
    });
  });
});
