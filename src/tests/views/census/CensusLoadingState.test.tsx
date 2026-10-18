import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CensusLoadingState } from '@/components/ui/CensusLoadingState';

describe('CensusLoadingState', () => {
  it('shows only Cargando: no icon, animation, creation action or large card', () => {
    render(<CensusLoadingState />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status.textContent).toBe('Cargando');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(status.querySelector('img,svg')).not.toBeInTheDocument();
  });
});
