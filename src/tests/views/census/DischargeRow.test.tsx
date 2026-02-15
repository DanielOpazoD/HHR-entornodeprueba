import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DischargeRow } from '@/features/census/components/DischargeRow';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('DischargeRow', () => {
  it('renders row data and dispatches actions', () => {
    const item = DataFactory.createMockDischarge({
      id: 'd1',
      patientName: 'Paciente Alta',
      status: 'Fallecido',
    });
    const onUndo = vi.fn().mockResolvedValue(undefined);
    const onEdit = vi.fn();
    const onDelete = vi.fn().mockResolvedValue(undefined);

    render(
      <table>
        <tbody>
          <DischargeRow
            item={item}
            recordDate="2026-02-14"
            onUndo={onUndo}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </tbody>
      </table>
    );

    expect(screen.getByText('Paciente Alta')).toBeInTheDocument();
    expect(screen.getByText('Fallecido')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Deshacer (Restaurar a Cama)'));
    fireEvent.click(screen.getByTitle('Editar'));
    fireEvent.click(screen.getByTitle('Eliminar Registro'));

    expect(onUndo).toHaveBeenCalledWith('d1');
    expect(onEdit).toHaveBeenCalledWith(item);
    expect(onDelete).toHaveBeenCalledWith('d1');
  });
});
