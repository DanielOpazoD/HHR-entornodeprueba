import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { CensusMovementDateTimeCell } from '@/features/census/components/CensusMovementDateTimeCell';

describe('CensusMovementDateTimeCell', () => {
  it('renders time and date label', () => {
    render(<CensusMovementDateTimeCell recordDate="2024-12-11" movementTime="06:00" />);

    expect(screen.getByText('06:00')).toBeInTheDocument();
    expect(screen.getByText('(12-12-2024)')).toBeInTheDocument();
  });

  it('renders fallback time when movement time is missing', () => {
    render(<CensusMovementDateTimeCell recordDate="2024-12-11" movementTime={undefined} />);

    expect(screen.getByText('--:--')).toBeInTheDocument();
    expect(screen.getByText('(11-12-2024)')).toBeInTheDocument();
  });
});
