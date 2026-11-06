import { render, screen } from '@testing-library/react';
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
  it('shows the available measurement, hospital time, units and census severity tones', () => {
    render(<ClinicalExplorerVitals patient={patient(reading)} />);
    expect(screen.getByText(/Última toma disponible/)).toHaveTextContent('11-07-2026 17:00');
    expect(screen.getByText('130/82')).toHaveTextContent('mmHg');
    expect(screen.getByText('PAM').nextElementSibling).toHaveTextContent('98');
    expect(screen.getByText('88')).toHaveClass('text-red-600');
    expect(screen.getByText('EVA').nextElementSibling).toHaveTextContent('0');
    expect(screen.queryByText('FR')).toBeNull();
    expect(screen.queryByText('HGT')).toBeNull();
    expect(screen.getByText('Observación sintética')).toBeVisible();
  });

  it('clears the previous patient measurement when another episode occupies the bed', () => {
    const view = render(<ClinicalExplorerVitals patient={patient(reading)} />);
    view.rerender(<ClinicalExplorerVitals patient={{ ...patient(), episodeId: 'new-episode' }} />);
    expect(screen.queryByText('130/82')).toBeNull();
    expect(screen.queryByText('Observación sintética')).toBeNull();
    expect(screen.getByText('Sin signos vitales disponibles en este censo.')).toBeVisible();
  });

  it('uses the pediatric profile instead of adult thresholds for a young infant', () => {
    const infant = patient({ ...reading, heartRate: 140 });
    infant.data.age = '2 meses';
    render(<ClinicalExplorerVitals patient={infant} />);
    expect(screen.getByText('140')).toHaveClass('text-slate-600');
  });
});
