import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CmaSectionRow } from '@/features/census/components/CmaSectionRow';
import { TransferRow } from '@/features/census/components/TransferRow';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { CMAData } from '@/types/domain/movements';

const transferItem = DataFactory.createMockTransfer({
  id: 'transfer-1',
  patientName: 'Paciente traslado',
});

const cmaItem: CMAData = {
  id: 'cma-1',
  bedName: 'R2',
  patientName: 'Paciente CMA',
  rut: '22.222.222-2',
  age: '42',
  diagnosis: 'Diagnóstico',
  specialty: 'Cirugía',
  interventionType: 'Cirugía Mayor Ambulatoria',
  dischargeTime: '14:30',
};

describe('movement IEEH actions', () => {
  it('does not expose IEEH in transfers', () => {
    render(
      <table>
        <tbody>
          <TransferRow
            item={transferItem}
            recordDate="2026-07-22"
            onUndo={vi.fn().mockResolvedValue(undefined)}
            onEdit={vi.fn()}
            onDelete={vi.fn().mockResolvedValue(undefined)}
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

  it('does not expose IEEH in CMA', () => {
    render(
      <table>
        <tbody>
          <CmaSectionRow
            item={cmaItem}
            recordDate="2026-07-22"
            onUpdate={vi.fn()}
            onUndo={vi.fn()}
            onDelete={vi.fn()}
            onConvertToDischarge={vi.fn()}
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
