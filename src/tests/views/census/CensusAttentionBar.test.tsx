import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CensusAttentionBar } from '@/features/census/components/CensusAttentionBar';
import type { CensusAttentionFilter } from '@/features/census/controllers/rowAcuityController';
import { DataFactory } from '@/tests/factories/DataFactory';

const DAY = '2026-07-13';

const Harness: React.FC = () => {
  const [filter, setFilter] = useState<CensusAttentionFilter>('all');
  return (
    <>
      <span data-testid="active-filter">{filter}</span>
      <CensusAttentionBar
        beds={{
          R1: DataFactory.createMockPatient('R1', {
            patientName: 'Paciente aislado',
            isIsolated: true,
          }),
        }}
        censusIsoDay={DAY}
        activeFilter={filter}
        onFilterChange={setFilter}
      />
    </>
  );
};

describe('CensusAttentionBar', () => {
  it('turns attention indicators into toggleable surveillance filters', () => {
    render(<Harness />);

    const attention = screen.getByTestId('census-attention-filter-all');
    const isolation = screen.getByTestId('census-attention-filter-isolation');

    expect(attention).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(attention);
    expect(screen.getByTestId('active-filter')).toHaveTextContent('attention');
    expect(attention).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(isolation);
    expect(screen.getByTestId('active-filter')).toHaveTextContent('isolation');
    expect(isolation).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(isolation);
    expect(screen.getByTestId('active-filter')).toHaveTextContent('all');
    expect(screen.queryByTestId('census-attention-filter-clear')).not.toBeInTheDocument();
  });

  it('stays hidden when there is nothing to watch and the full census is active', () => {
    render(<CensusAttentionBar beds={{}} censusIsoDay={DAY} />);
    expect(screen.queryByTestId('census-attention-bar')).not.toBeInTheDocument();
  });
});
