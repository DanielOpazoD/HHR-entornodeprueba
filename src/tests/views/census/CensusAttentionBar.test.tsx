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
            patientName: 'Paciente con escala pendiente',
            evaluationScores: {
              braden: {
                code: 'BRADEN',
                name: 'Escala de riesgo UPP (Braden)',
                encounterEventId: 1,
                total: 17,
                severity: 'Riesgo bajo',
                recordedDate: '2026-07-05',
                recordedAt: '05-07-2026 08:00',
              },
            },
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
  it('shows only the compact scale filter and toggles the full census', () => {
    render(<Harness />);

    const scale = screen.getByTestId('census-attention-filter-scale');
    expect(scale).toHaveTextContent('1 escala');
    expect(scale).toHaveAttribute('aria-pressed', 'false');
    expect(scale).toHaveClass('min-h-8', 'px-2', 'text-[11px]');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('Vigilancia')).not.toBeInTheDocument();
    expect(screen.queryByText(/requiere atención/)).not.toBeInTheDocument();
    expect(screen.queryByText(/aislamiento/)).not.toBeInTheDocument();

    fireEvent.click(scale);
    expect(screen.getByTestId('active-filter')).toHaveTextContent('scale');
    expect(scale).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(scale);
    expect(screen.getByTestId('active-filter')).toHaveTextContent('all');
  });

  it('does not surface isolation-only attention in this shortcut', () => {
    render(
      <CensusAttentionBar
        beds={{
          R1: DataFactory.createMockPatient('R1', {
            patientName: 'Paciente aislado',
            isIsolated: true,
          }),
        }}
        censusIsoDay={DAY}
      />
    );

    expect(screen.queryByTestId('census-attention-bar')).not.toBeInTheDocument();
  });

  it('stays hidden when there is nothing to watch and the full census is active', () => {
    render(<CensusAttentionBar beds={{}} censusIsoDay={DAY} />);
    expect(screen.queryByTestId('census-attention-bar')).not.toBeInTheDocument();
  });
});
