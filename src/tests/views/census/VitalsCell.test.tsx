import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { VitalsCell } from '@/features/census/components/patient-row/VitalsCell';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { PatientData } from '@/types/domain/patient';
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

const renderCell = (vitalSigns?: PatientVitalSigns, bedId = 'R1', patient?: Partial<PatientData>) =>
  render(
    <table>
      <tbody>
        <tr>
          <VitalsCell
            data={DataFactory.createMockPatient(bedId, {
              patientName: 'X',
              vitalSigns,
              ...patient,
            })}
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

  it('does not use neonatal ranges solely because the bed is NEO', () => {
    renderCell(
      {
        ...VITALS,
        heartRate: 45,
      },
      'NEO1',
      { birthDate: '1986-01-01', age: '40' }
    );

    expect(screen.getByText('45')).toHaveClass('text-amber-600');
  });

  it('uses neonatal ranges by age regardless of the bed and shows no population label', () => {
    renderCell(
      {
        ...VITALS,
        heartRate: 126,
      },
      'R1',
      { birthDate: '2026-06-20', age: '21d' }
    );

    expect(screen.getByText('126')).toHaveClass('text-slate-600');
    fireEvent.click(screen.getByRole('button', { name: 'Ver signos vitales' }));
    expect(screen.getByText('Última toma')).toBeInTheDocument();
    expect(screen.queryByText(/rangos RN/i)).not.toBeInTheDocument();
  });

  it('uses the historical paediatric profile without adding a visible age label', () => {
    renderCell(
      {
        ...VITALS,
        heartRate: 145,
        respiratoryRate: 38,
      },
      'R2',
      { birthDate: '2024-07-11', age: '2a' }
    );

    expect(screen.getByText('145')).toHaveClass('text-amber-600');
    fireEvent.click(screen.getByRole('button', { name: 'Ver signos vitales' }));
    expect(screen.queryByText(/pediátrico|años|perfil/i)).not.toBeInTheDocument();
  });
});
