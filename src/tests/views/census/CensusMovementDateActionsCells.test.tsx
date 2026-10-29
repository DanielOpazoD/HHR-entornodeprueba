import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { CensusMovementDateActionsCells } from '@/features/census/components/CensusMovementDateActionsCells';

describe('CensusMovementDateActionsCells', () => {
  it('renders date-time and action buttons', () => {
    const undo = vi.fn();
    const edit = vi.fn();

    render(
      <table>
        <tbody>
          <tr>
            <CensusMovementDateActionsCells
              context={{ bedName: 'R6', patientName: 'Paciente Sintético' }}
              recordDate="2026-02-14"
              movementDate="2026-02-14"
              movementTime="06:00"
              actions={[
                { kind: 'undo', title: 'Deshacer', onClick: undo },
                { kind: 'edit', title: 'Editar', onClick: edit },
              ]}
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByText('06:00')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Deshacer' }));
    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editar' }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledTimes(1);
  });
});
