import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScoresCell } from '@/features/census/components/patient-row/ScoresCell';
import { ClinicalAlertsViewCell } from '@/features/census/components/patient-row/ClinicalAlertsViewCell';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { PatientClinicalAlert } from '@/types/domain/clinicalAlerts';

const patient = (clinicalAlerts?: PatientClinicalAlert[]) =>
  DataFactory.createMockPatient('R1', { patientName: 'Paciente Sintético', clinicalAlerts });

const renderRow = (cell: React.ReactNode) =>
  render(
    <table>
      <tbody>
        <tr>{cell}</tr>
      </tbody>
    </table>
  );

describe('census «Alertas» from the Eloísa chart', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps the Scores column free of alerts: they live in the «Alertas» view', () => {
    renderRow(
      <ScoresCell
        data={patient([{ id: 'a-1', text: 'Nota sintética', recordedAt: '2026-11-03T08:00' }])}
        currentDateString="2026-11-03"
      />
    );
    expect(screen.queryByText(/Alertas/)).toBeNull();
  });

  it('opens the active notes with author, age on the hospital calendar and visitor mark', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 2026-11-03 12:00 in Rapa Nui (UTC-5).
    vi.setSystemTime(new Date('2026-11-03T17:00:00.000Z'));
    renderRow(
      <ClinicalAlertsViewCell
        data={patient([
          {
            id: 'a-2',
            text: 'Nota sintética reciente',
            recordedAt: '2026-10-31T08:15',
            author: 'Profesional Sintético',
            role: 'Enfermera(o)',
          },
          {
            id: 'a-1',
            text: 'Nota sintética para visitas',
            recordedAt: '2026-09-25T23:40',
            visitor: true,
          },
        ])}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ver las 2 alertas de la ficha' }));

    const notes = await screen.findAllByRole('listitem');
    expect(within(screen.getByRole('dialog')).getAllByRole('listitem')).toEqual(notes);
    // Message first, then date, age on the hospital calendar and only the author's name.
    expect(notes[0]).toHaveTextContent(
      'Nota sintética reciente31-10-2026 08:15 · hace 3 días · Profesional Sintético'
    );
    expect(notes[1]).toHaveTextContent(
      'Nota sintética para visitas25-09-2026 23:40 · hace 39 días · Visita'
    );
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Enfermera(o)');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Copia de la ficha');
  });
});
