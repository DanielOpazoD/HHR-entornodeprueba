import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CudyrExclusionSummary } from '@/features/cudyr/components/CudyrExclusionSummary';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { confirmedReportInput } from '@/tests/services/cudyr/reportFixtures';

const fixture = () => {
  const data = buildCudyrReport(confirmedReportInput());
  const base = data.rows[0];
  data.rows = [
    {
      ...base,
      key: 'found',
      patientName: 'Persona Registrada',
      eligibility: 'no_elegible',
      modality: 'uea',
      evaluation: { ...base.evaluation!, author: 'Profesional Sintético', recordedAt: '' },
    },
    {
      ...base,
      key: 'absent',
      patientName: 'Persona Sin Registro',
      eligibility: 'no_elegible',
      modality: 'uea',
      evaluation: null,
      cudyrStatus: 'sin_registro_observado',
    },
    {
      ...base,
      key: 'pending',
      patientName: 'Persona Pendiente',
      eligibility: 'no_elegible',
      modality: 'uea',
      evaluation: null,
      cudyrStatus: 'sin_captura',
    },
    {
      ...base,
      key: 'resolved',
      patientName: 'Egreso Resuelto',
      eligibility: 'no_elegible',
      modality: 'uea',
      resolvedSystemDeparture: true,
    },
    { ...base, key: 'eligible', patientName: 'Persona Elegible', eligibility: 'elegible' },
  ];
  return data;
};

describe('excluded patient-day drilldown', () => {
  it('shows exactly the excluded group and distinguishes absence from pending verification', () => {
    render(<CudyrExclusionSummary data={fixture()} />);
    fireEvent.click(screen.getByText(/No elegibles del mes/));
    fireEvent.click(screen.getByRole('button', { name: 'Urgencias / UEA' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Persona Registrada')).toBeInTheDocument();
    expect(dialog.getByText('Profesional Sintético')).toBeInTheDocument();
    expect(dialog.getByText('No informada')).toBeInTheDocument();
    expect(dialog.getByText('No registrado')).toBeInTheDocument();
    expect(dialog.getByText('Verificación pendiente')).toBeInTheDocument();
    expect(dialog.queryByText('Egreso Resuelto')).not.toBeInTheDocument();
    expect(dialog.queryByText('Persona Elegible')).not.toBeInTheDocument();
  });
  it('opens registered-only drilldown from its count and can show the whole group', () => {
    render(<CudyrExclusionSummary data={fixture()} />);
    fireEvent.click(screen.getByText(/No elegibles del mes/));
    fireEvent.click(screen.getByRole('button', { name: 'Ver con CUDYR: Urgencias / UEA' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('checkbox')).toBeChecked();
    expect(dialog.queryByText('Persona Sin Registro')).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole('checkbox'));
    expect(dialog.getByText('Persona Sin Registro')).toBeInTheDocument();
  });
});
