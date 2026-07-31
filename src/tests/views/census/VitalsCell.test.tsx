import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { VitalsCell } from '@/features/census/components/patient-row/VitalsCell';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';

const VITALS: PatientVitalSigns = {
  recordedDate: '2026-07-11',
  recordedAt: '11-07-2026 20:57',
  systolic: 130,
  diastolic: 82,
  heartRate: 84,
  spo2: 88,
  temperature: 36.5,
  respiratoryRate: 18,
  painEva: 3,
  hgt: null,
  insulinUnits: null,
  insulinQuadrant: null,
  observations: 'PAM 94',
  author: '',
  authorRole: '',
};

const renderCell = (vitalSigns?: PatientVitalSigns, bedId = 'R1') =>
  render(
    <table>
      <tbody>
        <tr>
          <VitalsCell
            data={DataFactory.createMockPatient(bedId, { patientName: 'X', vitalSigns })}
          />
        </tr>
      </tbody>
    </table>
  );

describe('VitalsCell', () => {
  it('shows PA · FC · SAT · T° inline and opens the vitals modal on click', () => {
    renderCell(VITALS);

    expect(screen.getByText('130/82')).toBeInTheDocument();
    expect(screen.getByText('84')).toBeInTheDocument(); // FC
    expect(screen.getByText('88')).toBeInTheDocument(); // SAT (low → styled, still shown)
    expect(screen.getByText('36.5')).toBeInTheDocument(); // T°

    fireEvent.click(screen.getByRole('button', { name: 'Ver signos vitales' }));
    // The detail modal surfaces FR / EVA / observations that are not inline in the cell.
    expect(screen.getByText('PAM 94')).toBeInTheDocument();
  });

  it('renders an empty marker when there are no vitals', () => {
    const { container } = renderCell(undefined);
    expect(container.querySelector('button')).toBeNull();
    expect(screen.getByTitle('Sin signos vitales')).toBeInTheDocument();
  });

  it('uses neonatal ranges for standalone NEO beds', () => {
    renderCell(
      {
        ...VITALS,
        systolic: 70,
        diastolic: 40,
        heartRate: 126,
        spo2: 98,
        respiratoryRate: 44,
      },
      'NEO1'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ver signos vitales' }));
    expect(screen.getByText('Última toma · rangos RN')).toBeInTheDocument();
  });
});
