import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { CensusView } from '@/features/census/components/CensusView';
import { useCensusViewModel } from '@/features/census/hooks/useCensusViewModel';
import { useCensusMigrationBootstrap } from '@/features/census/hooks/useCensusMigrationBootstrap';
import { BedType } from '@/types/domain/beds';
import type { BedDefinition } from '@/types/domain/beds';

const { mockUseAuth } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
}));

const mockUseDailyRecordData = vi.fn();
const mockUseDailyRecordStatus = vi.fn();

vi.mock('@/context', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => mockUseDailyRecordData(),
  useDailyRecordStatus: () => mockUseDailyRecordStatus(),
}));

vi.mock('@/features/census/hooks/useCensusViewModel', () => ({
  useCensusViewModel: vi.fn(),
}));

vi.mock('@/features/census/hooks/useCensusMigrationBootstrap', () => ({
  useCensusMigrationBootstrap: vi.fn(),
}));

vi.mock('@/components/ui/ViewLoader', () => ({
  ViewLoader: () => <div data-testid="view-loader">View Loader</div>,
}));

vi.mock('@/utils/dateUtils', async () => {
  const actual = await vi.importActual('@/utils/dateUtils');
  return {
    ...actual,
    getTodayISO: () => '2025-01-01',
  };
});

vi.mock('@/components/shared/SectionErrorBoundary', () => ({
  SectionErrorBoundary: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/features/census/components/EmptyDayPrompt', () => ({
  EmptyDayPrompt: () => <div data-testid="empty-day-prompt">Empty Day Prompt</div>,
}));

vi.mock('@/features/census/components/CensusRegisterContent', () => ({
  CensusRegisterContent: ({
    readOnly,
  }: {
    readOnly: boolean;
    visibleBeds: Array<{ id: string }>;
  }) => (
    <div data-testid="census-register-content">
      <div data-testid="census-staff-header">Census Staff Header</div>
      <div data-testid="census-table">Census Table</div>
      <div data-testid="discharges-section">Discharges Section</div>
      <div data-testid="transfers-section">Transfers Section</div>
      <div data-testid="cma-section">CMA Section</div>
      {!readOnly && <div data-testid="census-modals">Census Modals</div>}
    </div>
  ),
}));

describe('CensusView', () => {
  const defaultProps = {
    selectedDay: 1,
    selectedMonth: 0,
    currentDateString: '2025-01-01',
    showBedManagerModal: false,
    onCloseBedManagerModal: vi.fn(),
  };

  type CensusViewModel = ReturnType<typeof useCensusViewModel>;
  const baseViewModel = {
    beds: null,
    previousRecordAvailable: false,
    previousRecordDate: undefined,
    availableDates: [],
    createDay: vi.fn(),
    stats: null,
    marginStyle: {},
    visibleBeds: [],
  } as unknown as CensusViewModel;

  const buildViewModel = (overrides: Partial<CensusViewModel> = {}): CensusViewModel => ({
    ...baseViewModel,
    ...overrides,
  });
  const buildVisibleBed = (id: string): BedDefinition => ({
    id,
    name: id,
    type: BedType.MEDIA,
    isCuna: false,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockUseAuth.mockReturnValue({
      sessionState: { status: 'authorized', user: { uid: 'user-1' } },
      isLoading: false,
      isAuthenticated: true,
      isFirebaseConnected: true,
      remoteSyncStatus: 'ready',
    });
    mockUseDailyRecordData.mockReturnValue({
      bootstrapPhase: 'confirmed_empty',
    });
    mockUseDailyRecordStatus.mockReturnValue({
      bootstrapPhase: 'confirmed_empty',
      syncStatus: 'idle',
      lastSyncTime: null,
    });
    vi.mocked(useCensusViewModel).mockReturnValue(buildViewModel());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders EmptyDayPrompt when record is missing', async () => {
    vi.useFakeTimers();
    vi.mocked(useCensusViewModel).mockReturnValue(
      buildViewModel({ beds: null, availableDates: ['2024-12-31'] })
    );

    render(<CensusView {...defaultProps} />);

    expect(screen.queryByTestId('census-operational-state-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('empty-day-prompt')).not.toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    vi.useRealTimers();
    expect(await screen.findByTestId('empty-day-prompt')).toBeInTheDocument();
    expect(vi.mocked(useCensusMigrationBootstrap)).toHaveBeenCalledWith(true);
  });

  it('shows the empty prompt immediately for dates that are not today', async () => {
    vi.useFakeTimers();
    vi.mocked(useCensusViewModel).mockReturnValue(buildViewModel({ beds: null }));

    render(<CensusView {...defaultProps} currentDateString="2025-01-02" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_300);
    });
    vi.useRealTimers();
    expect(await screen.findByTestId('empty-day-prompt')).toBeInTheDocument();
    expect(screen.queryByTestId('view-loader')).not.toBeInTheDocument();
  });

  it('keeps waiting silently while remote sync is still bootstrapping for an authenticated session', async () => {
    vi.useFakeTimers();
    mockUseAuth.mockReturnValue({
      sessionState: { status: 'authorized', user: { uid: 'user-1' } },
      isLoading: false,
      isAuthenticated: true,
      isFirebaseConnected: false,
      remoteSyncStatus: 'bootstrapping',
    });
    mockUseDailyRecordData.mockReturnValue({
      bootstrapPhase: 'remote_record_bootstrapping',
    });
    mockUseDailyRecordStatus.mockReturnValue({
      bootstrapPhase: 'remote_record_bootstrapping',
      syncStatus: 'idle',
      lastSyncTime: null,
    });
    vi.mocked(useCensusViewModel).mockReturnValue(buildViewModel({ beds: null }));

    render(<CensusView {...defaultProps} currentDateString="2025-01-02" />);

    expect(screen.queryByTestId('census-operational-state-banner')).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.queryByTestId('empty-day-prompt')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders main census sections when record is present', async () => {
    vi.mocked(useCensusViewModel).mockReturnValue(
      buildViewModel({
        beds: {},
        visibleBeds: [buildVisibleBed('H1C1')],
      })
    );

    render(<CensusView {...defaultProps} />);

    expect(await screen.findByTestId('census-staff-header')).toBeInTheDocument();
    expect(await screen.findByTestId('census-table')).toBeInTheDocument();
    expect(await screen.findByTestId('discharges-section')).toBeInTheDocument();
    expect(await screen.findByTestId('transfers-section')).toBeInTheDocument();
    expect(await screen.findByTestId('cma-section')).toBeInTheDocument();
  });

  it('renders the census table immediately when record data is already present', () => {
    vi.mocked(useCensusViewModel).mockReturnValue(
      buildViewModel({
        beds: {},
        visibleBeds: [buildVisibleBed('H1C1')],
      })
    );

    render(<CensusView {...defaultProps} />);

    expect(screen.queryByTestId('view-loader')).not.toBeInTheDocument();
    expect(screen.getByTestId('census-table')).toBeInTheDocument();
  });

  it('renders CensusModals when not in readOnly mode', async () => {
    vi.mocked(useCensusViewModel).mockReturnValue(
      buildViewModel({
        beds: {},
      })
    );

    render(<CensusView {...defaultProps} readOnly={false} />);

    expect(await screen.findByTestId('census-modals')).toBeInTheDocument();
  });

  it('hides CensusModals in readOnly mode', () => {
    vi.mocked(useCensusViewModel).mockReturnValue(
      buildViewModel({
        beds: {},
      })
    );

    render(<CensusView {...defaultProps} readOnly={true} />);

    expect(screen.queryByTestId('census-modals')).not.toBeInTheDocument();
  });
});
