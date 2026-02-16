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
              recordDate="2026-02-14"
              movementDate="2026-02-14"
              movementTime="06:00"
              actions={[
                { kind: 'undo', title: 'Deshacer', onClick: undo, className: 'x' },
                { kind: 'edit', title: 'Editar', onClick: edit, className: 'y' },
              ]}
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByText('06:00')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Deshacer'));
    fireEvent.click(screen.getByTitle('Editar'));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledTimes(1);
  });
});
