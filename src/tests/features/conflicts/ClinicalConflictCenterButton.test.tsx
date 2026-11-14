import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ClinicalConflictCenterButton } from '@/components/clinical-conflicts/ClinicalConflictCenterButton';

describe('ClinicalConflictCenterButton', () => {
  it('shows count and attention as neutral menu text without an icon', () => {
    render(
      <ClinicalConflictCenterButton
        snapshotCount={2}
        requiresAttention
        testId="menu-conflicts"
        label="Conflictos HHR"
      />
    );
    const item = screen.getByRole('button', { name: 'Conflictos HHR · 2 · revisión requerida' });
    expect(item).toHaveAttribute('data-census-menu-action');
    expect(item).toHaveClass('text-slate-600');
    expect(item.querySelector('svg')).toBeNull();
    expect(item.querySelector('[aria-hidden]')).toBeNull();
  });

  it('names only the entry when there is nothing to review', () => {
    render(
      <ClinicalConflictCenterButton
        snapshotCount={0}
        requiresAttention={false}
        testId="menu-conflicts"
        label="Conflictos HHR"
      />
    );
    expect(screen.getByRole('button', { name: 'Conflictos HHR' })).toBeInTheDocument();
  });
});
