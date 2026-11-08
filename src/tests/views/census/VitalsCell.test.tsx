import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
  it.each([
    [130, 98, 'PA 130/82 mmHg; FC 84 lpm; SAT 98 %; T° 36.5 °C'],
    [182, 91, 'PA 182/82 mmHg, alerta; FC 84 lpm; SAT 91 %, revisar; T° 36.5 °C'],
  ])('names readings and their status for PA %s and SAT %s', (systolic, spo2, readings) => {
    renderCell({ ...VITALS, systolic, spo2 }, 'R1', { age: '44', birthDate: undefined });
    const name = `Signos vitales: ${readings}. Abrir detalle`;
    const button = screen.getByRole('button', { name });
    expect(button).toHaveAccessibleName(name);
    expect(button).not.toHaveAttribute('title');
  });

  it('does not expose carried measurement dates or provenance in the census cell', () => {
    renderCell(VITALS, 'R1', {
      clinicalEpisodeId: 'synthetic',
      clinicalCarryover: {
        sourceDate: '2026-07-11',
        clinicalEpisodeId: 'synthetic',
        vitalsPending: true,
        devicesPending: true,
      },
    });
    const button = screen.getByRole('button', { name: /^Signos vitales:/ });
    expect(button).toHaveTextContent('130/82');
    expect(screen.queryByText(/11\/07\/2026|2026-07-11|Previa/)).not.toBeInTheDocument();
    expect(button.querySelector('time')).toBeNull();
    expect(button).not.toHaveAttribute('title');
    expect(button).not.toHaveAttribute('aria-description');
    expect(screen.queryByText(/Por verificar|pendiente de verificar/i)).not.toBeInTheDocument();
  });

  it('does not add a date footer for a new measurement when carryover metadata remains', () => {
    renderCell({ ...VITALS, recordedDate: '2026-07-12' }, 'R1', {
      clinicalEpisodeId: 'synthetic',
      clinicalCarryover: {
        sourceDate: '2026-07-11',
        clinicalEpisodeId: 'synthetic',
        vitalsPending: true,
        devicesPending: false,
      },
    });
    expect(screen.queryByText(/12\/07\/2026|2026-07-12/)).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: /^Signos vitales:/ });
    expect(button).not.toHaveAttribute('aria-description');
    expect(button).not.toHaveAttribute('title');
    expect(
      screen.queryByText(/Previa|Por verificar|pendiente de verificar/i)
    ).not.toBeInTheDocument();
  });

  it('shows PA · FC · SAT · T° inline and opens the vitals modal on click', async () => {
    renderCell(VITALS);

    expect(screen.getByText('130/82')).toBeInTheDocument();
    expect(screen.getByText('84')).toBeInTheDocument(); // FC
    expect(screen.getByText('88')).toBeInTheDocument(); // SAT keeps its status color without an alarm icon.
    expect(screen.getByText('88')).not.toHaveClass('decoration-dotted');
    expect(screen.getByText('36.5')).toBeInTheDocument(); // T°
    expect(screen.queryByTitle('SAT: 88 % · Fuera de rango')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Signos vitales:/ })).not.toHaveAttribute(
      'aria-description'
    );
    expect(screen.getByText('88').querySelector('svg')).toBeNull();
    expect(screen.getByRole('button', { name: /^Signos vitales:/ })).not.toHaveClass(
      'border-l-red-500'
    );

    fireEvent.click(screen.getByRole('button', { name: /^Signos vitales:/ }));
    // The detail modal surfaces FR / EVA / observations that are not inline in the cell.
    expect(await screen.findByText('PAM 94')).toBeInTheDocument();
    expect(screen.queryByText('Cargando historial…')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders an empty marker when there are no vitals', () => {
    const { container } = renderCell(undefined);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('.census-vitals-grid')).toHaveTextContent('PA—FC—SAT—T°—');
    expect(screen.queryByTitle('Sin signos vitales')).not.toBeInTheDocument();
  });

  it('shows rounded PAM only in the detail table, including a single measurement', async () => {
    renderCell({ ...VITALS, spo2: 98, meanArterialPressure: 87.7 }, 'R1', { age: '44' });
    expect(screen.queryByText('PAM')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Signos vitales:/ }));
    expect(await screen.findByRole('columnheader', { name: 'PAM' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '88' })).toBeInTheDocument();
  });

  it('keeps detail-only readings available without adding an inline warning', async () => {
    renderCell({ ...VITALS, spo2: 98, painEva: 8 }, 'R1', { age: '44' });

    expect(screen.getByRole('button', { name: /^Signos vitales:/ })).not.toHaveAttribute(
      'aria-description'
    );
    fireEvent.click(screen.getByRole('button', { name: /^Signos vitales:/ }));
    expect(await screen.findByText('8')).toBeInTheDocument();
    expect(screen.queryByText('Fuera de rango')).toBeNull();
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

  it('uses neonatal ranges by age regardless of the bed and shows no population label', async () => {
    renderCell(
      {
        ...VITALS,
        heartRate: 126,
      },
      'R1',
      { birthDate: '2026-06-20', age: '21d' }
    );

    expect(screen.getByText('126')).toHaveClass('text-slate-600');
    fireEvent.click(screen.getByRole('button', { name: /^Signos vitales:/ }));
    expect(await screen.findByText('Última toma')).toBeInTheDocument();
    expect(screen.queryByText(/rangos RN/i)).not.toBeInTheDocument();
  });

  it('uses the historical paediatric profile without adding a visible age label', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: /^Signos vitales:/ }));
    await screen.findByText('Última toma');
    expect(screen.queryByText(/pediátrico|años|perfil/i)).not.toBeInTheDocument();
  });

  it('uses a bare completed-year age when birth date is unavailable', () => {
    renderCell(VITALS, 'R3', { age: '52', birthDate: undefined });

    expect(screen.getByText('88')).toHaveClass('text-red-600');
  });

  it('keeps age-only readings aligned between the cell and history table', async () => {
    const latest = { ...VITALS, heartRate: 79 };
    renderCell(latest, 'R3', {
      age: '21d',
      birthDate: undefined,
      vitalSignsHistory: [
        latest,
        {
          ...VITALS,
          recordedDate: '2026-07-10',
          recordedAt: '10-07-2026 08:00',
          heartRate: 78,
        },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: /^Signos vitales:/ }));
    const historySection = (await screen.findByText('Historial · 2 tomas')).closest('section');
    expect(historySection).not.toBeNull();
    const history = within(historySection as HTMLElement);
    // The latest row keeps the census cell's tone; an older one cannot be classified by age alone.
    expect(screen.getAllByText('79')[0]).toHaveClass('text-red-600');
    expect(history.getByText('79').closest('td')).toHaveClass('text-red-600');
    expect(
      history.getByText('79').parentElement?.querySelector('[aria-label="Fuera de rango"]')
    ).toBeNull();
    expect(history.getByText('78').closest('td')).toHaveClass('text-slate-500');
  });

  it('keeps the severity tone of the census cell in the detail cards and history', async () => {
    renderCell(VITALS, 'R3', {
      age: '52',
      birthDate: undefined,
      vitalSignsHistory: [VITALS, { ...VITALS, recordedAt: '11-07-2026 06:00' }],
    });
    expect(screen.getByText('88')).toHaveClass('text-red-600');

    fireEvent.click(screen.getByRole('button', { name: /^Signos vitales:/ }));
    await screen.findByText('Última toma');
    const dialog = within(screen.getByRole('dialog'));
    const card = dialog.getAllByText('88')[0];
    expect(card).toHaveClass('text-red-600');
    expect(card.parentElement).toHaveClass('border-red-200', 'bg-red-50');
    const history = within(
      (await screen.findByText('Historial · 2 tomas')).closest('section') as HTMLElement
    );
    // Newest first: the latest row matches the cell.
    expect(history.getAllByText('88')[0].closest('td')).toHaveClass('text-red-600');
  });
});
