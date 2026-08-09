import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
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
      isApplyingCensus={false}
      isPreviewOpen={false}
      isSyncing={false}
      error={null}
      hasPersistedSync={Boolean(persistedSync)}
      persistedSync={persistedSync}
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
