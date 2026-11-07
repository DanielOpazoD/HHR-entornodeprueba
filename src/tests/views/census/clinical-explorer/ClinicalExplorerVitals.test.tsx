import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ClinicalExplorerVitals } from '@/features/census/components/clinical-explorer/ClinicalExplorerVitals';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';

const reading: PatientVitalSigns = {
  recordedDate: '2026-07-11',
  recordedAt: '2026-07-11T23:00:00Z',
  systolic: 130,
  diastolic: 82,
  meanArterialPressure: 98,
  heartRate: 84,
  spo2: 88,
  temperature: 36.5,
  respiratoryRate: null,
  painEva: 0,
  hgt: null,
  insulinUnits: null,
  insulinQuadrant: null,
  observations: 'Observación sintética',
  author: '',
  authorRole: '',
};
const patient = (vitalSigns?: PatientVitalSigns) => ({
  bedId: 'R1',
  episodeId: 'synthetic-episode',
  data: DataFactory.createMockPatient('R1', { age: '44', vitalSigns }),
});

describe('ClinicalExplorerVitals', () => {
  it('shows the measurement date without time, units and census severity tones', () => {
    render(<ClinicalExplorerVitals patient={patient(reading)} censusDate="2026-07-11" />);
    expect(screen.getByText('11-07-2026')).toBeVisible();
    expect(screen.queryByText(/17:00|23:00/)).toBeNull();
    expect(screen.queryByText(/Última toma disponible|Censo · Eloísa/)).toBeNull();
    expect(screen.getByText('130/82')).toHaveTextContent('mmHg');
    expect(screen.getByText('PAM').nextElementSibling).toHaveTextContent('98');
    expect(screen.getByText('88')).toHaveClass('text-red-600');
    expect(screen.getByText('EVA').nextElementSibling).toHaveTextContent('0');
    expect(screen.queryByText('FR')).toBeNull();
    expect(screen.queryByText('HGT')).toBeNull();
    expect(screen.getByText('Observación sintética')).toBeVisible();
  });

  it('clears the previous patient measurement when another episode occupies the bed', () => {
    const view = render(
      <ClinicalExplorerVitals patient={patient(reading)} censusDate="2026-07-11" />
    );
    view.rerender(
      <ClinicalExplorerVitals
        patient={{ ...patient(), episodeId: 'new-episode' }}
        censusDate="2026-07-11"
      />
    );
    expect(screen.queryByText('130/82')).toBeNull();
    expect(screen.queryByText('Observación sintética')).toBeNull();
    expect(screen.getByText('Sin signos vitales disponibles en este censo.')).toBeVisible();
  });

  it('uses the pediatric profile instead of adult thresholds for a young infant', () => {
    const infant = patient({ ...reading, heartRate: 140 });
    infant.data.age = '2 meses';
    render(<ClinicalExplorerVitals patient={infant} censusDate="2026-07-11" />);
    expect(screen.getByText('140')).toHaveClass('text-slate-600');
  });
  it('opens the census history and closes it permanently when the episode changes', async () => {
    const current = patient(reading);
    current.data.vitalSignsHistory = [
      { ...reading, recordedAt: '2026-07-10T23:00:00Z', recordedDate: '2026-07-10', systolic: 110 },
      reading,
    ];
    const view = render(<ClinicalExplorerVitals patient={current} censusDate="2026-07-11" />);
    fireEvent.click(screen.getByRole('button', { name: 'Signos vitales' }));
    expect(await screen.findByText('Historial · 2 tomas')).toBeVisible();
    expect(within(screen.getByRole('dialog')).getByText('110/82')).toBeVisible();
    view.rerender(
      <ClinicalExplorerVitals
        patient={{ ...patient(), episodeId: 'another' }}
        censusDate="2026-07-11"
      />
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    view.rerender(<ClinicalExplorerVitals patient={current} censusDate="2026-07-11" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows daily balances, switches period and places the patient alerts below vitals', () => {
    const current = patient(reading);
    current.data.fluidBalance = {
      censusDate: '2026-07-11',
      day: { intakeMl: 1200, urineOutputMl: 700, records: 2 },
      night: { intakeMl: 500, urineOutputMl: 400, records: 1 },
    };
    current.data.clinicalAlerts = [
      {
        id: 'a',
        text: 'Alerta sintética',
        recordedAt: '2026-07-11T17:30',
        author: 'Profesional sintético',
      },
    ];
    const view = render(<ClinicalExplorerVitals patient={current} censusDate="2026-07-11" />);
    const vitals = screen.getByRole('region', { name: 'Signos vitales' });
    expect(vitals).toHaveTextContent('1.700 ml');
    expect(vitals).toHaveTextContent('1.100 ml');
    fireEvent.click(within(vitals).getByRole('button', { name: 'Día' }));
    expect(vitals).toHaveTextContent('1.200 ml');
    expect(vitals).toHaveTextContent('700 ml');
    expect(screen.getByRole('region', { name: 'Alertas' })).toHaveTextContent('Alerta sintética');
    view.rerender(<ClinicalExplorerVitals patient={patient()} censusDate="2026-07-11" />);
    expect(screen.queryByText('Alerta sintética')).toBeNull();
    expect(screen.queryByText('1.200 ml')).toBeNull();
  });

  it('does not present another census day balance as current', () => {
    const current = patient();
    current.data.fluidBalance = {
      censusDate: '2026-07-10',
      day: { intakeMl: 999, urineOutputMl: 888, records: 2 },
      night: { intakeMl: 0, urineOutputMl: 0, records: 0 },
    };
    render(<ClinicalExplorerVitals patient={current} censusDate="2026-07-11" />);
    expect(screen.queryByText('999 ml')).toBeNull();
    expect(
      screen.queryByText('Ingresos y diuresis sin datos sincronizados para este día.')
    ).toBeNull();
  });
});
