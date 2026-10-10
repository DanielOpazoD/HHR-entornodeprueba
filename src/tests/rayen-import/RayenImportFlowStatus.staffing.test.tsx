import { act, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RayenImportFlowStatus } from '@/features/rayen-import/components/RayenImportFlowStatus';
import type { RayenFillProgress } from '@/features/rayen-import/hooks/useRayenFillStatus';

const fill = (overrides: Partial<RayenFillProgress> = {}): RayenFillProgress => ({
  running: false,
  outcome: 'idle',
  attemptId: 0,
  done: 0,
  total: 0,
  errors: 0,
  lastCompletedAt: null,
  staffingOutcome: 'idle',
  ...overrides,
});

const renderStatus = (
  progress: RayenFillProgress,
  persistedSync?: ComponentProps<typeof RayenImportFlowStatus>['persistedSync']
) =>
  render(
    <RayenImportFlowStatus
      diff={null}
      fill={progress}
      error={null}
      hasPersistedSync={Boolean(persistedSync)}
      persistedSync={persistedSync}
      executionStage={persistedSync ? null : { type: 'complete' }}
    />
  );

describe('RayenImportFlowStatus staffing observations', () => {
  it('does not turn an independent staffing ambiguity into a clinical warning', () => {
    renderStatus(
      fill({
        outcome: 'complete',
        attemptId: 1,
        done: 8,
        total: 8,
        lastCompletedAt: '2026-07-21T17:00:00.000Z',
        staffingOutcome: 'ambiguous',
      })
    );

    expect(screen.getByText('Todo al día')).toBeVisible();
    expect(screen.queryByText(/Enfermería\/TENS/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('keeps persisted staffing observations out of the clinical status', () => {
    renderStatus(fill(), {
      status: 'complete',
      coverage: {
        total: 8,
        completed: 8,
        errors: 0,
        sourceErrors: 0,
        completedAt: '2026-07-21T17:00:00.000Z',
      },
      staffingObservation: {
        ambiguousSections: ['nurse_night'],
        ignoredBoundaryRecords: 2,
      },
    });

    expect(screen.getByText('Todo al día').parentElement).toHaveClass('sr-only');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).not.toHaveTextContent('Enfermería/TENS');
    expect(screen.queryByText('Última sincronización con observaciones')).not.toBeInTheDocument();
  });

  it('keeps a completed sync green when staffing only has handoff-boundary traceability', () => {
    renderStatus(fill(), {
      status: 'complete',
      coverage: {
        total: 12,
        completed: 12,
        errors: 0,
        sourceErrors: 0,
        completedAt: '2026-07-27T18:57:04.000Z',
      },
      staffingObservation: {
        ambiguousSections: [],
        ignoredBoundaryRecords: 8,
      },
    });

    expect(screen.getByText('Todo al día').parentElement).toHaveClass('sr-only');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryByText('Última sincronización con observaciones')).not.toBeInTheDocument();
  });
});

describe('compact synchronization presentation', () => {
  it('delays the single slow indicator and clears it immediately on completion', () => {
    vi.useFakeTimers();
    try {
      const base = {
        diff: null,
        error: null,
        hasPersistedSync: false,
        compactFallback: 'Sin sincronizar',
      };
      const view = render(
        <RayenImportFlowStatus {...base} fill={fill({ running: true, done: 1, total: 2 })} />
      );
      expect(screen.getByRole('status')).toHaveTextContent('Lectura clínica · 1/2');
      const arc = view.container.querySelector('svg')!;
      expect(arc).toHaveClass('invisible', 'motion-reduce:animate-none', '[animation-duration:2s]');
      act(() => vi.advanceTimersByTime(300));
      expect(arc).not.toHaveClass('invisible');
      view.rerender(
        <RayenImportFlowStatus
          {...base}
          fill={fill({ lastCompletedAt: '2026-07-21T17:00:00.000Z' })}
          executionStage={{ type: 'complete' }}
        />
      );
      expect(screen.getByRole('status')).toHaveTextContent('Actualizado · 11:00');
      expect(view.container.querySelector('svg')).toBeNull();
      expect(view.container.querySelector('section')).toHaveClass('h-4');
    } finally {
      vi.useRealTimers();
    }
  });
  it('shows measured reading progress, then confirmation without a false 100% claim', () => {
    const base = {
      diff: null,
      error: null,
      hasPersistedSync: false,
      compactFallback: 'Anterior',
      executionStage: { type: 'syncing_clinical' as const },
    };
    const view = render(
      <RayenImportFlowStatus {...base} fill={fill({ running: true, done: 3, total: 12 })} />
    );
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');
    expect(screen.getByRole('progressbar').firstElementChild).toHaveStyle({ width: '25%' });
    view.rerender(
      <RayenImportFlowStatus {...base} fill={fill({ running: true, done: 12, total: 12 })} />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Confirmando datos clínicos');
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(view.container.querySelector('.rayen-sync-scan')).toBeInTheDocument();
    view.rerender(
      <RayenImportFlowStatus {...base} fill={fill()} executionStage={{ type: 'complete' }} />
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows capture activity without inventing a progress value', () => {
    render(
      <RayenImportFlowStatus
        diff={null}
        error={null}
        hasPersistedSync={false}
        compactFallback="Anterior"
        fill={fill()}
        executionStage={{ type: 'capturing' }}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Leyendo Eloísa');
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });

  it('does not label a partial result as updated and retains accessible detail', () => {
    render(
      <RayenImportFlowStatus
        diff={null}
        error="Una fuente no respondió"
        fill={fill()}
        hasPersistedSync={false}
        compactFallback="Anterior"
        executionStage={{ type: 'partial', retry: 'clinical_only' }}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Actualización parcial');
    expect(screen.getByText('Ver detalle')).toBeInTheDocument();
    expect(screen.getByText('Una fuente no respondió')).toBeInTheDocument();
  });
});
