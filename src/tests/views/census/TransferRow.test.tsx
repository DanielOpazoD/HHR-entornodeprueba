import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TransferRow } from '@/features/census/components/TransferRow';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('TransferRow', () => {
  it('renders transfer center/escort and dispatches actions', () => {
    const item = DataFactory.createMockTransfer({
      id: 't1',
      patientName: 'Paciente Traslado',
      receivingCenter: 'Otro',
      receivingCenterOther: 'Clinica Demo',
      transferEscort: 'Enfermera Demo',
      evacuationMethod: 'Ambulancia',
    });
    const onUndo = vi.fn().mockResolvedValue(undefined);
    const onEdit = vi.fn();
    const onDelete = vi.fn().mockResolvedValue(undefined);

    render(
      <table>
        <tbody>
          <TransferRow
            item={item}
            recordDate="2026-02-14"
            onUndo={onUndo}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </tbody>
      </table>
    );

    expect(screen.getByText('Paciente Traslado')).toBeInTheDocument();
    expect(screen.getByText('Clinica Demo')).toBeInTheDocument();
    expect(screen.getByText(/Acompaña: Enfermera Demo/)).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Deshacer (Restaurar a Cama)'));
    fireEvent.click(screen.getByTitle('Editar'));
    fireEvent.click(screen.getByTitle('Eliminar Registro'));

    expect(onUndo).toHaveBeenCalledWith('t1');
    expect(onEdit).toHaveBeenCalledWith(item);
    expect(onDelete).toHaveBeenCalledWith('t1');
  });
});
