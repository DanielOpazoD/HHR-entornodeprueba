import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CensusTableHeader } from '@/features/census/components/CensusTableHeader';
import { ClinicalAlertsViewCell } from '@/features/census/components/patient-row/ClinicalAlertsViewCell';
import { ScoresCell } from '@/features/census/components/patient-row/ScoresCell';
import { setCensusViewPreference } from '@/features/census/hooks/useCensusViewPreferences';
import type { CensusTableHeaderProps } from '@/features/census/types/censusTableComponentContracts';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { PatientClinicalAlert } from '@/types/domain/clinicalAlerts';

const scales = vi.hoisted(() => ({ visible: true }));
vi.mock('@/features/census/hooks/useNursingScalesVisible', () => ({
  useNursingScalesVisible: () => scales.visible,
}));

const columns: CensusTableHeaderProps['columns'] = {
  actions: 40,
  bed: 54,
  type: 0,
  name: 310,
  rut: 0,
  age: 0,
  diagnosis: 280,
  specialty: 0,
  status: 32,
  admission: 116,
  dmi: 96,
  scores: 150,
  cqx: 0,
  upc: 48,
};

const renderHeader = () =>
  render(
    <table>
      <CensusTableHeader
        scoresAction={<span>Atajo de reaplicación</span>}
        readOnly={false}
        columns={columns}
        isEditMode={false}
        canDeleteRecord={false}
        resetDayDeniedMessage=""
        onClearAll={vi.fn().mockResolvedValue(undefined)}
        diagnosisMode="free"
        onToggleDiagnosisMode={vi.fn()}
        onResizeColumn={() => vi.fn()}
      />
    </table>
  );

const alert = (id: string, day: string, text: string): PatientClinicalAlert => ({
  id,
  text,
  recordedAt: `2026-11-0${day}T09:30`,
  author: 'Profesional Sintético',
  role: 'Enfermera(o)',
});

describe('census view for the Eloísa chart alerts', () => {
  afterEach(() => {
    act(() => setCensusViewPreference({ alertsView: false }));
    scales.visible = true;
  });

  it('swaps Signos, DMI, Scores and UPC for one alerts column and back, remembered here', () => {
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Alertas' }));

    const merged = screen.getByRole('columnheader', { name: /Alertas de la ficha/ });
    expect(merged).toHaveAttribute('colspan', '4');
    expect(merged).toHaveStyle({ width: '410px' });
    expect(screen.queryByText('Signos')).toBeNull();
    expect(screen.queryByText('UPC')).toBeNull();
    expect(JSON.parse(localStorage.getItem('hhr_census_view_v1') ?? '{}')).toMatchObject({
      alertsView: true,
    });

    fireEvent.click(within(merged).getByRole('button', { name: 'Columnas' }));
    expect(screen.getByText('Signos')).toBeInTheDocument();
    expect(screen.getByText('UPC')).toBeInTheDocument();
  });

  it('shows the three newest alerts as date and message, and every alert on click', async () => {
    const alerts = [
      alert('a-4', '4', 'Pauta caídas adjunta, próxima evaluación 06/11'),
      alert('a-3', '3', 'Pauta Braden adjunta, próxima evaluación 05/11'),
      alert('a-2', '2', 'Nota sintética dos'),
      alert('a-1', '1', 'Nota sintética uno'),
    ];
    render(
      <table>
        <tbody>
          <tr>
            <ClinicalAlertsViewCell
              data={DataFactory.createMockPatient('R1', { clinicalAlerts: alerts })}
            />
          </tr>
        </tbody>
      </table>
    );

    const cell = screen.getByRole('button', { name: 'Ver las 4 alertas de la ficha' });
    expect(cell.closest('td')).toHaveAttribute('colspan', '4');
    // Date and message only: the time stays in the detail.
    expect(cell).toHaveTextContent(
      '04-11Pauta caídas adjunta, próxima evaluación 06/1103-11Pauta Braden adjunta, próxima evaluación 05/1102-11Nota sintética dos+1 más'
    );
    expect(cell).not.toHaveTextContent('09:30');
    expect(cell).not.toHaveTextContent('Profesional Sintético');

    fireEvent.click(cell);
    expect(await screen.findAllByRole('listitem')).toHaveLength(4);
  });

  it('hides Braden and Downton, and their reapplication shortcut, when an admin turns them off', () => {
    const patient = DataFactory.createMockPatient('R1', {
      evaluationScores: {
        braden: {
          code: 'BRADEN',
          name: 'Braden',
          encounterEventId: 20261103100000,
          total: 18,
          severity: 'Riesgo bajo',
          recordedDate: '2026-11-03',
          recordedAt: '2026-11-03T10:00:00',
        },
      },
    });
    const renderCensus = () => {
      renderHeader();
      render(
        <table>
          <tbody>
            <tr>
              <ScoresCell data={patient} currentDateString="2026-11-03" />
            </tr>
          </tbody>
        </table>
      );
    };
    renderCensus();
    expect(screen.getByText('Braden')).toBeInTheDocument();
    expect(screen.getByText('Atajo de reaplicación')).toBeInTheDocument();
    cleanup();

    scales.visible = false;
    renderCensus();

    expect(screen.queryByText('Braden')).toBeNull();
    expect(screen.queryByText('Atajo de reaplicación')).toBeNull();
    // The «Alertas» switch sits only next to Scores.
    expect(screen.getAllByRole('button', { name: 'Alertas' })).toHaveLength(1);
    expect(screen.getByText('Signos').closest('th')).not.toContainElement(
      screen.getByRole('button', { name: 'Alertas' })
    );
  });
});
