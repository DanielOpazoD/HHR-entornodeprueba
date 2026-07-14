import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CensusRegisterContent } from '@/features/census/components/CensusRegisterContent';

const mockUseDailyRecordStatus = vi.fn();

vi.mock('@/features/census/components/CensusActionsContext', () => ({
  CensusActionsProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="census-actions-provider">{children}</div>
  ),
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordStatus: () => mockUseDailyRecordStatus(),
}));

vi.mock('@/context/CensusContext', () => ({
  useCensusContext: () => ({
    dateNav: { clinicalToday: '2026-03-10', goToClinicalToday: () => {} },
  }),
}));

vi.mock('@/features/census/components/CensusPrintHeader', () => ({
  CensusPrintHeader: () => <div data-testid="census-print-header" />,
}));

vi.mock('@/features/census/components/CensusStaffHeader', () => ({
  CensusStaffHeader: ({
    attentionFilter,
    onAttentionFilterChange,
  }: {
    attentionFilter: string;
    onAttentionFilterChange: (filter: 'scale') => void;
  }) => (
    <div data-testid="census-staff-header">
      <span data-testid="staff-attention-filter">{attentionFilter}</span>
      <button type="button" onClick={() => onAttentionFilterChange('scale')}>
        Filtrar escalas
      </button>
    </div>
  ),
}));

vi.mock('@/features/census/components/CensusRegisterMainContent', () => ({
  CensusRegisterMainContent: ({ attentionFilter }: { attentionFilter: string }) => (
    <div data-testid="census-table" data-attention-filter={attentionFilter} />
  ),
}));

vi.mock('@/features/census/components/CensusRegisterSections', () => ({
  CensusRegisterSections: () => <div data-testid="census-register-sections" />,
}));

describe('CensusRegisterContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDailyRecordStatus.mockReturnValue({
      syncStatus: 'idle',
      lastSyncTime: null,
      bootstrapPhase: 'record_ready',
      isInitialRemoteHydrationPending: false,
      isSaving: false,
      hasError: false,
      isIdle: true,
      isSaved: false,
    });
  });

  it('renders the primary census table before deferred secondary sections', async () => {
    render(
      <CensusRegisterContent
        currentDateString="2026-03-10"
        readOnly={false}
        beds={{}}
        visibleBeds={[]}
        marginStyle={{}}
        stats={null}
        showBedManagerModal={false}
        onCloseBedManagerModal={vi.fn()}
      />
    );

    // Initial synchronous render: primary table present, deferred sections absent.
    expect(screen.getByTestId('census-staff-header')).toBeInTheDocument();
    expect(screen.getByTestId('census-table')).toBeInTheDocument();
    expect(screen.queryByTestId('census-register-sections')).not.toBeInTheDocument();
    expect(screen.queryByTestId('census-register-sections-loading')).not.toBeInTheDocument();

    // After the deferred enhancement settles, the secondary sections appear.
    expect(await screen.findByTestId('census-register-sections')).toBeInTheDocument();
  });

  it('wires the attention filter from the operational header into the census table', () => {
    const props = {
      currentDateString: '2026-03-10',
      readOnly: false,
      beds: {},
      visibleBeds: [],
      marginStyle: {},
      stats: null,
      showBedManagerModal: false,
      onCloseBedManagerModal: vi.fn(),
    };
    const { rerender } = render(<CensusRegisterContent {...props} />);

    expect(screen.getByTestId('staff-attention-filter')).toHaveTextContent('all');
    expect(screen.getByTestId('census-table')).toHaveAttribute('data-attention-filter', 'all');

    fireEvent.click(screen.getByRole('button', { name: 'Filtrar escalas' }));
    expect(screen.getByTestId('staff-attention-filter')).toHaveTextContent('scale');
    expect(screen.getByTestId('census-table')).toHaveAttribute('data-attention-filter', 'scale');

    rerender(<CensusRegisterContent {...props} currentDateString="2026-03-11" />);
    expect(screen.getByTestId('staff-attention-filter')).toHaveTextContent('scale');
  });

  it('keeps remote reconciliation as internal state without adding a visible banner', () => {
    mockUseDailyRecordStatus.mockReturnValue({
      syncStatus: 'idle',
      lastSyncTime: null,
      bootstrapPhase: 'remote_record_bootstrapping',
      isInitialRemoteHydrationPending: true,
      isSaving: false,
      hasError: false,
      isIdle: true,
      isSaved: false,
    });

    render(
      <CensusRegisterContent
        currentDateString="2026-03-10"
        readOnly={false}
        beds={{}}
        visibleBeds={[]}
        marginStyle={{}}
        stats={null}
        showBedManagerModal={false}
        onCloseBedManagerModal={vi.fn()}
      />
    );

    expect(screen.queryByTestId('census-operational-state-banner')).not.toBeInTheDocument();
    expect(screen.queryByText('Reconciliando Firebase')).not.toBeInTheDocument();
    expect(screen.queryByText(/comparando la copia local con Firebase/i)).not.toBeInTheDocument();
  });

  it('does not show the operational banner once the census is remote-confirmed', () => {
    render(
      <CensusRegisterContent
        currentDateString="2026-03-10"
        readOnly={false}
        beds={{}}
        visibleBeds={[]}
        marginStyle={{}}
        stats={null}
        showBedManagerModal={false}
        onCloseBedManagerModal={vi.fn()}
      />
    );

    expect(screen.queryByTestId('census-operational-state-banner')).not.toBeInTheDocument();
  });

  it('does not schedule secondary sections for specialist access', async () => {
    render(
      <CensusRegisterContent
        currentDateString="2026-03-10"
        readOnly={false}
        beds={{}}
        visibleBeds={[]}
        marginStyle={{}}
        stats={null}
        showBedManagerModal={false}
        onCloseBedManagerModal={vi.fn()}
        accessProfile="specialist"
      />
    );

    expect(screen.getByTestId('census-table')).toBeInTheDocument();

    // Wait long enough that any zero-delay deferred task would have fired, then confirm
    // the deferred sections never get scheduled for the specialist profile.
    await waitFor(() => {
      expect(screen.queryByTestId('census-register-sections')).not.toBeInTheDocument();
      expect(screen.queryByTestId('census-register-sections-loading')).not.toBeInTheDocument();
    });
  });
});
