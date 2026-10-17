import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CensusRegisterContent } from '@/features/census/components/CensusRegisterContent';
import { runExclusiveDailyRecordWrite } from '@/services/repositories/dailyRecordWriteCoordinator';

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
  CensusStaffHeader: ({ readOnly }: { readOnly: boolean }) => (
    <div data-testid="census-staff-header" data-read-only={readOnly} />
  ),
}));

vi.mock('@/features/census/components/CensusRegisterMainContent', () => ({
  CensusRegisterMainContent: ({
    attentionFilter,
    scoresAction,
    readOnly,
  }: {
    attentionFilter: string;
    scoresAction: React.ReactNode;
    readOnly: boolean;
  }) => (
    <div
      data-testid="census-table"
      data-attention-filter={attentionFilter}
      data-read-only={readOnly}
    >
      <table>
        <thead>
          <tr>
            <th>Escalas {scoresAction}</th>
          </tr>
        </thead>
      </table>
    </div>
  ),
}));

vi.mock('@/features/census/components/CensusRegisterSections', () => ({
  CensusRegisterSections: ({ readOnly }: { readOnly: boolean }) => (
    <div data-testid="census-register-sections" data-read-only={readOnly}>
      {!readOnly && <input aria-label="Borrador abierto" defaultValue="" />}
    </div>
  ),
}));

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

const baseProps = {
  currentDateString: '2026-03-10',
  readOnly: false,
  beds: {},
  visibleBeds: [],
  marginStyle: {},
  stats: null,
  showBedManagerModal: false,
  onCloseBedManagerModal: vi.fn(),
};

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

  it('pauses table editing only during a sync turn and retains open drafts and sync controls', async () => {
    render(<CensusRegisterContent {...baseProps} />);
    const draft = await screen.findByRole('textbox', { name: 'Borrador abierto' });
    fireEvent.change(draft, { target: { value: 'Datos pendientes' } });
    const ordinaryGate = deferred();
    const syncGate = deferred();
    let ordinary!: Promise<void>;
    let sync!: Promise<unknown>;
    try {
      await act(async () => {
        ordinary = runExclusiveDailyRecordWrite(
          baseProps.currentDateString,
          () => ordinaryGate.promise
        );
        sync = runExclusiveDailyRecordWrite(
          baseProps.currentDateString,
          async () => {
            await syncGate.promise;
            throw new Error('Sync failed');
          },
          { kind: 'structural_sync' }
        ).catch(error => error);
      });
      expect(screen.getByTestId('census-table')).toHaveAttribute('data-read-only', 'false');
      expect(screen.getByRole('status')).toHaveTextContent('Guardando cambios… · 2 pendientes');
      await act(async () => {
        ordinaryGate.resolve();
        await ordinary;
      });
      expect(screen.getByTestId('census-table')).toHaveAttribute('data-read-only', 'true');
      expect(screen.getByRole('status')).toHaveTextContent('Guardando sincronización…');
      expect(screen.getByTestId('census-staff-header')).toHaveAttribute('data-read-only', 'false');
      expect(screen.getByRole('textbox', { name: 'Borrador abierto' })).toBe(draft);
      expect(draft).toHaveValue('Datos pendientes');
      await act(async () => {
        syncGate.resolve();
        await sync;
      });
      expect(screen.getByTestId('census-table')).toHaveAttribute('data-read-only', 'false');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(draft).toHaveValue('Datos pendientes');
    } finally {
      ordinaryGate.resolve();
      syncGate.resolve();
      await Promise.all([ordinary, sync]);
    }
  });

  it('does not pause another census date or restore editing when permissions are read-only', async () => {
    const view = render(<CensusRegisterContent {...baseProps} />);
    const gate = deferred();
    let write!: Promise<void>;
    try {
      await act(async () => {
        write = runExclusiveDailyRecordWrite('2026-03-11', () => gate.promise, {
          kind: 'clinical_sync',
        });
      });
      expect(screen.getByTestId('census-table')).toHaveAttribute('data-read-only', 'false');
      view.rerender(
        <CensusRegisterContent {...baseProps} currentDateString="2026-03-11" readOnly />
      );
      expect(screen.getByTestId('census-table')).toHaveAttribute('data-read-only', 'true');
      await act(async () => {
        gate.resolve();
        await write;
      });
      expect(screen.getByTestId('census-table')).toHaveAttribute('data-read-only', 'true');
      expect(screen.getByTestId('census-staff-header')).toHaveAttribute('data-read-only', 'true');
    } finally {
      gate.resolve();
      await write;
    }
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

  it('wires the attention filter from the scales column header into the census table', () => {
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

    expect(screen.getByTestId('census-table')).toHaveAttribute('data-attention-filter', 'all');

    const clock = screen.getByTestId('census-attention-filter-scale');
    expect(screen.getByRole('columnheader')).toContainElement(clock);
    fireEvent.click(clock);
    expect(screen.getByTestId('census-attention-filter-scale')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByTestId('census-table')).toHaveAttribute('data-attention-filter', 'scale');

    rerender(<CensusRegisterContent {...props} currentDateString="2026-03-11" />);
    expect(screen.getByTestId('census-attention-filter-scale')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
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
