import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CmaSectionRow } from '@/features/census/components/CmaSectionRow';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/features/census/components/IEEHFormDialog', () => ({
  IEEHFormDialog: ({
    patient,
    baseDischargeData,
  }: {
    patient: { patientName?: string };
    baseDischargeData: { dischargeDate?: string; dischargeTime?: string };
  }) => (
    <div>
      IEEH CMA {patient.patientName} {baseDischargeData.dischargeDate}{' '}
      {baseDischargeData.dischargeTime}
    </div>
  ),
}));

vi.mock('@/features/clinical-documents', () => ({
  ClinicalDocumentsModal: ({
    isOpen,
    patient,
    currentDateString,
    bedId,
  }: {
    isOpen: boolean;
    patient: { patientName?: string; rut?: string; clinicalEpisodeId?: string };
    currentDateString: string;
    bedId: string;
  }) =>
    isOpen ? (
      <div data-testid="clinical-documents-modal">
        Docs {patient.patientName} {patient.rut} {patient.clinicalEpisodeId} {currentDateString}{' '}
        {bedId}
      </div>
    ) : null,
}));

describe('CmaSectionRow', () => {
  it('renders item values and emits update callbacks', () => {
    const item = DataFactory.createMockCMA({
      id: 'cma-1',
      patientName: 'Paciente Test',
      dischargeTime: '11:00',
    });
    const onUpdate = vi.fn();

    render(
      <table>
        <tbody>
          <CmaSectionRow
            item={item}
            recordDate="2026-04-30"
            onUpdate={onUpdate}
            onUndo={vi.fn().mockResolvedValue(undefined)}
            onDelete={vi.fn()}
            onConvertToDischarge={vi.fn()}
          />
        </tbody>
      </table>
    );

    expect(screen.getByText('Paciente Test')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('11:00'), {
      target: { value: '12:15' },
    });
    expect(onUpdate).toHaveBeenCalledWith('cma-1', { dischargeTime: '12:15' });
  });

  it('uses fallback undo title when record has no original bed', () => {
    const item = DataFactory.createMockCMA({
      id: 'cma-2',
      originalBedId: undefined,
    });

    render(
      <table>
        <tbody>
          <CmaSectionRow
            item={item}
            recordDate="2026-04-30"
            onUpdate={vi.fn()}
            onUndo={vi.fn().mockResolvedValue(undefined)}
            onDelete={vi.fn()}
            onConvertToDischarge={vi.fn()}
          />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    expect(
      screen.getByRole('menuitem', { name: /Deshacer \(sin datos originales\)/i })
    ).toBeInTheDocument();
  });

  it('opens the IEEH dialog for CMA records with original patient data', async () => {
    const item = DataFactory.createMockCMA({
      id: 'cma-ieeh',
      dischargeTime: '19:45',
      originalBedId: 'R1',
      originalData: DataFactory.createMockPatient('R1', { patientName: 'Paciente CMA' }),
    });

    render(
      <table>
        <tbody>
          <CmaSectionRow
            item={item}
            recordDate="2026-04-30"
            onUpdate={vi.fn()}
            onUndo={vi.fn().mockResolvedValue(undefined)}
            onDelete={vi.fn()}
            onConvertToDischarge={vi.fn()}
          />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Generar Informe Estadístico de Egreso (IEEH)'));

    expect(await screen.findByText('IEEH CMA Paciente CMA 2026-04-30 19:45')).toBeInTheDocument();
  });

  it('shows a labeled IEEH button and builds a patient snapshot when CMA has no original data', async () => {
    const item = DataFactory.createMockCMA({
      id: 'cma-ieeh-fallback',
      patientName: 'Paciente Sin Snapshot',
      rut: '11.111.111-1',
      age: '64',
      diagnosis: 'Procedimiento ambulatorio',
      specialty: 'Cirugía',
      dischargeTime: '13:20',
      originalData: undefined,
    });

    render(
      <table>
        <tbody>
          <CmaSectionRow
            item={item}
            recordDate="2026-04-30"
            onUpdate={vi.fn()}
            onUndo={vi.fn().mockResolvedValue(undefined)}
            onDelete={vi.fn()}
            onConvertToDischarge={vi.fn()}
          />
        </tbody>
      </table>
    );

    const ieehButton = screen.getByRole('button', { name: /IEEH/i });
    fireEvent.click(ieehButton);

    expect(
      await screen.findByText('IEEH CMA Paciente Sin Snapshot 2026-04-30 13:20')
    ).toBeInTheDocument();
  });

  it('renders the IEEH action after the delete action', () => {
    const item = DataFactory.createMockCMA({ id: 'cma-action-order' });

    render(
      <table>
        <tbody>
          <CmaSectionRow
            item={item}
            recordDate="2026-04-30"
            onUpdate={vi.fn()}
            onUndo={vi.fn().mockResolvedValue(undefined)}
            onDelete={vi.fn()}
            onConvertToDischarge={vi.fn()}
          />
        </tbody>
      </table>
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons.at(-2)).toHaveAttribute('title', 'Abrir menú de acciones');
    expect(buttons.at(-1)).toHaveTextContent('IEEH');
  });

  it('sends the complete CMA item when delete is requested from the menu', () => {
    const item = DataFactory.createMockCMA({ id: 'cma-delete-row' });
    const onDelete = vi.fn();

    render(
      <table>
        <tbody>
          <CmaSectionRow
            item={item}
            recordDate="2026-04-30"
            onUpdate={vi.fn()}
            onUndo={vi.fn().mockResolvedValue(undefined)}
            onDelete={onDelete}
            onConvertToDischarge={vi.fn()}
          />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /eliminar/i }));

    expect(onDelete).toHaveBeenCalledWith(item);
  });

  it('opens clinical documents for a discharged CMA case from the shared menu', async () => {
    const item = DataFactory.createMockCMA({
      id: 'cma-docs',
      patientName: 'Paciente CMA',
      rut: '33.333.333-3',
      clinicalEpisodeId: 'ep_cma_case',
      originalBedId: 'R3',
      originalData: DataFactory.createMockPatient('R3', {
        patientName: 'Paciente CMA Snapshot',
        rut: '33.333.333-3',
        clinicalEpisodeId: 'ep_old_snapshot',
      }),
    });

    render(
      <table>
        <tbody>
          <CmaSectionRow
            item={item}
            recordDate="2026-04-30"
            onUpdate={vi.fn()}
            onUndo={vi.fn().mockResolvedValue(undefined)}
            onDelete={vi.fn()}
            onConvertToDischarge={vi.fn()}
          />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /visualizar documentos clínicos/i }));

    expect(await screen.findByTestId('clinical-documents-modal')).toHaveTextContent(
      'Docs Paciente CMA Snapshot 33.333.333-3 ep_cma_case 2026-04-30 R3'
    );
  });
});
