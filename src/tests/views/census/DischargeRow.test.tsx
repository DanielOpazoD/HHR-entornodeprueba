import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DischargeRow } from '@/features/census/components/DischargeRow';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/features/census/components/PatientHospitalizationReportsDialog', () => ({
  PatientHospitalizationReportsDialog: ({
    isOpen,
    patientName,
    patientRun,
    currentEpisodeId,
    censusDate,
  }: {
    isOpen: boolean;
    patientName: string;
    patientRun: string;
    currentEpisodeId?: string;
    censusDate?: string;
  }) =>
    isOpen ? (
      <tr>
        <td data-testid="hospitalization-reports-dialog">
          {patientName} {patientRun} {currentEpisodeId} {censusDate}
        </td>
      </tr>
    ) : null,
}));

vi.mock('@/features/census/components/FugaNotificationModal', () => ({
  FugaNotificationModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? (
      <tr data-testid="fuga-modal">
        <td />
      </tr>
    ) : null,
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

describe('DischargeRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders row data and dispatches actions', () => {
    const item = DataFactory.createMockDischarge({
      id: 'd1',
      patientName: 'Paciente Alta',
      status: 'Vivo',
      dischargeType: 'Domicilio (Habitual)',
    });
    const onUndo = vi.fn().mockResolvedValue(undefined);
    const onEdit = vi.fn();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onConvertToCma = vi.fn().mockResolvedValue(undefined);

    render(
      <table>
        <tbody>
          <DischargeRow
            item={item}
            recordDate="2026-02-14"
            onUndo={onUndo}
            onEdit={onEdit}
            onDelete={onDelete}
            onConvertToCma={onConvertToCma}
          />
        </tbody>
      </table>
    );

    expect(screen.getByText('Paciente Alta')).toBeInTheDocument();
    expect(screen.getByText('Vivo')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /deshacer/i }));
    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /^editar$/i }));
    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /eliminar/i }));
    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /convertir a cma/i }));

    expect(onUndo).toHaveBeenCalledWith('d1');
    expect(onEdit).toHaveBeenCalledWith(item);
    expect(onDelete).toHaveBeenCalledWith('d1');
    expect(onConvertToCma).toHaveBeenCalledWith('d1');
  });

  it('opens clinical documents from the movement action menu using the discharged episode snapshot', async () => {
    const item = DataFactory.createMockDischarge({
      id: 'd-docs',
      patientName: 'Paciente Alta',
      rut: '22.222.222-2',
      clinicalEpisodeId: 'ep_discharge_case',
      originalData: DataFactory.createMockPatient('R2', {
        patientName: 'Paciente Alta Snapshot',
        rut: '22.222.222-2',
        clinicalEpisodeId: 'ep_original_snapshot',
      }),
    });

    render(
      <table>
        <tbody>
          <DischargeRow
            item={item}
            recordDate="2026-02-14"
            onUndo={vi.fn().mockResolvedValue(undefined)}
            onEdit={vi.fn()}
            onDelete={vi.fn().mockResolvedValue(undefined)}
            onConvertToCma={vi.fn().mockResolvedValue(undefined)}
          />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /visualizar documentos clínicos/i }));

    expect(await screen.findByTestId('clinical-documents-modal')).toHaveTextContent(
      'Docs Paciente Alta Snapshot 22.222.222-2 ep_discharge_case 2026-02-14 R2'
    );
  });

  it('opens episode-aware hospitalization reports from the three-dot menu', async () => {
    const item = DataFactory.createMockDischarge({
      id: 'd-epicrisis',
      patientName: 'Paciente Alta',
      rut: '17.752.753-1',
      clinicalEpisodeId: '141336',
      movementDate: '2026-07-19',
    });

    render(
      <table>
        <tbody>
          <DischargeRow
            item={item}
            recordDate="2026-07-19"
            onUndo={vi.fn().mockResolvedValue(undefined)}
            onEdit={vi.fn()}
            onDelete={vi.fn().mockResolvedValue(undefined)}
            onConvertToCma={vi.fn().mockResolvedValue(undefined)}
          />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Abrir menú de acciones'));
    fireEvent.click(screen.getByRole('menuitem', { name: /informes de hospitalización/i }));

    expect(await screen.findByTestId('hospitalization-reports-dialog')).toHaveTextContent(
      'Paciente Alta 17.752.753-1 141336 2026-07-19'
    );
  });

  it('lazy-loads the fuga modal and keeps IEEH unavailable', async () => {
    const item = DataFactory.createMockDischarge({
      id: 'd2',
      patientName: 'Paciente Fuga',
      dischargeType: 'Fuga',
      status: 'Vivo',
      originalData: DataFactory.createMockPatient('bed1', {
        patientName: 'Paciente Fuga',
      }),
    });
    const onUndo = vi.fn().mockResolvedValue(undefined);
    const onEdit = vi.fn();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onConvertToCma = vi.fn().mockResolvedValue(undefined);

    render(
      <table>
        <tbody>
          <DischargeRow
            item={item}
            recordDate="2026-02-14"
            onUndo={onUndo}
            onEdit={onEdit}
            onDelete={onDelete}
            onConvertToCma={onConvertToCma}
          />
        </tbody>
      </table>
    );

    expect(screen.queryByTestId('fuga-modal')).not.toBeInTheDocument();
    expect(screen.queryByText('IEEH')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Notificar fuga por correo'));
    expect(await screen.findByTestId('fuga-modal')).toBeInTheDocument();

    expect(
      screen.queryByTitle('Generar Informe Estadístico de Egreso (IEEH)')
    ).not.toBeInTheDocument();
  });
});
