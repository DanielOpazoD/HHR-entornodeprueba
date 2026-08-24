import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';

import { RayenImportFlowStatus } from '@/features/rayen-import/components/RayenImportFlowStatus';
import type { RayenFillProgress } from '@/features/rayen-import/hooks/useRayenFillStatus';

const settledFill = (staffingOutcome: RayenFillProgress['staffingOutcome']): RayenFillProgress => ({
  running: false,
  outcome: 'complete',
  attemptId: 1,
  done: 8,
  total: 8,
  errors: 0,
  lastCompletedAt: '2026-07-21T17:00:00.000Z',
  staffingOutcome,
});

const renderSettledPulse = (
  staffingOutcome: RayenFillProgress['staffingOutcome'],
  stage: ComponentProps<typeof RayenImportFlowStatus>['executionStage'] = {
    type: 'complete',
  }
) =>
  render(
    <RayenImportFlowStatus
      diff={null}
      fill={settledFill(staffingOutcome)}
      error={null}
      hasPersistedSync={false}
      executionStage={stage}
    />
  );

describe('Rayen synchronization omissions in the pulse bar', () => {
  it('prioritizes a conflict-only review over the background syncing label', () => {
    render(
      <RayenImportFlowStatus
        diff={null}
        fill={{ ...settledFill('idle'), outcome: 'idle', done: 0, total: 0, attemptId: 0 }}
        error={null}
        hasPersistedSync={false}
        executionStage={{ type: 'needs_review', scope: 'structure' }}
      />
    );

    expect(screen.getByText('Revisar cambios del censo')).toBeVisible();
  });

  it('does not restore a partial persisted synchronization as fully successful', () => {
    render(
      <RayenImportFlowStatus
        diff={null}
        fill={{ ...settledFill('idle'), outcome: 'idle', done: 0, total: 0, attemptId: 0 }}
        error={null}
        hasPersistedSync
        persistedSync={{
          status: 'partial',
          coverage: {
            total: 8,
            completed: 7,
            errors: 1,
            sourceErrors: 1,
            completedAt: '2026-07-21T17:00:00.000Z',
          },
        }}
      />
    );

    expect(screen.queryByText('Todo al día')).not.toBeInTheDocument();
    expect(screen.getByText('Última sincronización con observaciones')).toBeVisible();
    expect(screen.getByRole('status')).not.toHaveTextContent('Enfermería/TENS');
  });

  it('does not degrade clinical success when an independent staffing proposal was declined', () => {
    renderSettledPulse('declined');

    expect(screen.getByText('Todo al día')).toBeVisible();
    expect(screen.queryByText(/se mantuvo HHR/)).not.toBeInTheDocument();
  });

  it('keeps skipped work visible after the decision modal closes', () => {
    renderSettledPulse('resolved', { type: 'partial', retry: 'clinical_only' });

    expect(screen.queryByText('Todo al día')).not.toBeInTheDocument();
    expect(screen.getByText('Información clínica pendiente de completar')).toBeVisible();
  });

  it('keeps unresolved conflicts visible after the decision modal closes', () => {
    renderSettledPulse('resolved', { type: 'needs_review', scope: 'structure' });

    expect(screen.queryByText('Todo al día')).not.toBeInTheDocument();
    expect(screen.getByText('Revisar cambios del censo')).toBeVisible();
  });
});
