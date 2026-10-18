import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CensusLoadingState } from '@/features/census/components/CensusLoadingState';

describe('CensusLoadingState', () => {
  it('announces loading without offering creation or adding a large card', () => {
    render(<CensusLoadingState />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Cargando censo…')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('status').querySelector('svg')).toHaveClass('census-manutara');
  });
  it('stops suggesting activity when the connection is unavailable', () => {
    render(<CensusLoadingState stalled message="Revisa la conexión" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByRole('status').querySelector('svg')).not.toHaveClass('census-manutara');
  });
});
