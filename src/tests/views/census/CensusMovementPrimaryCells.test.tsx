import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { CensusMovementPrimaryCells } from '@/features/census/components/CensusMovementPrimaryCells';

describe('CensusMovementPrimaryCells', () => {
  it('renders shared movement identity cells', () => {
    render(
      <table>
        <tbody>
          <tr>
            <CensusMovementPrimaryCells
              viewModel={{
                bedName: 'Cama 1',
                bedType: 'UTI',
                patientName: 'Paciente Uno',
                rut: '12345678-9',
                diagnosis: 'Dx',
              }}
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByText('Cama 1')).toBeInTheDocument();
    expect(screen.getByText('(UTI)')).toBeInTheDocument();
    expect(screen.getByText('Paciente Uno')).toBeInTheDocument();
    expect(screen.getByText('12345678-9')).toBeInTheDocument();
    expect(screen.getByText('Dx')).toBeInTheDocument();
  });
});
