import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClinicalConflictCenterButton } from '@/components/clinical-conflicts/ClinicalConflictCenterButton';

const renderButton = (snapshotCount: number, requiresAttention = false) =>
  render(
    <ClinicalConflictCenterButton
      onClick={vi.fn()}
      scopeLabel="Censo diario"
      snapshotCount={snapshotCount}
      requiresAttention={requiresAttention}
      testId="conflict-button"
      hideLabel={false}
      label="Conflictos HHR"
      variant="quick-action"
    />
  );

describe('ClinicalConflictCenterButton', () => {
  it('uses a calm neutral treatment when no conflict requires attention', () => {
    renderButton(2);

    expect(screen.getByTestId('conflict-button')).toHaveClass(
      'border-slate-200',
      'bg-slate-50',
      'text-slate-600'
    );
    expect(screen.getByText('2')).toHaveClass('bg-slate-200', 'text-slate-600');
    expect(screen.getByTestId('conflict-button')).toHaveAccessibleName(
      'Centro de conflictos clínicos de Censo diario'
    );
  });

  it('keeps the warning treatment when recoverable versions require attention', () => {
    renderButton(2, true);

    expect(screen.getByTestId('conflict-button')).toHaveClass(
      'border-amber-200',
      'bg-amber-50',
      'text-amber-700'
    );
    expect(screen.getByText('2')).toHaveClass('bg-amber-100', 'text-amber-700');
    expect(screen.getByTestId('conflict-button')).toHaveAccessibleName(
      'Centro de conflictos clínicos de Censo diario · revisión requerida'
    );
  });
});
