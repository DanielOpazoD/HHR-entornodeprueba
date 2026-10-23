import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CensusLoadingState } from '@/components/ui/CensusLoadingState';

describe('CensusLoadingState', () => {
  it('shows four decorative dots with an accessible loading label', () => {
    render(<CensusLoadingState />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Cargando')).toHaveClass('sr-only');
    expect(status.querySelectorAll('.census-loading-dots i')).toHaveLength(4);
    expect(status.querySelector('.census-loading-dots')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(status.querySelector('img,svg')).not.toBeInTheDocument();
  });
});
