import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CensusLoadingState } from '@/components/ui/CensusLoadingState';

describe('CensusLoadingState', () => {
  it('shows only Cargando and a decorative rotating icon, without creation or a large card', () => {
    render(<CensusLoadingState />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status.textContent).toBe('Cargando');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(status.querySelector('svg')).toHaveClass('census-manutara', 'h-16', 'w-20');
  });
});
