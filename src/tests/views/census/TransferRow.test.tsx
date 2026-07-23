import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TransferRow } from '@/features/census/components/TransferRow';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('TransferRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

    expect(screen.queryByTitle('Deshacer (Restaurar a Cama)')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Deshacer (Restaurar a Cama)' }));

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editar' }));

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Eliminar Registro' }));

    expect(onUndo).toHaveBeenCalledWith('t1');
    expect(onEdit).toHaveBeenCalledWith(item);
    expect(onDelete).toHaveBeenCalledWith('t1');
  });

  it('does not expose the IEEH action', () => {
    const item = DataFactory.createMockTransfer({
      id: 't2',
      patientName: 'Paciente Traslado',
      originalData: DataFactory.createMockPatient('bed1', {
        patientName: 'Paciente Traslado',
      }),
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

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    expect(
      screen.queryByRole('menuitem', {
        name: /Generar Informe Estadístico de Egreso \(IEEH\)/i,
      })
    ).not.toBeInTheDocument();
  });
});
