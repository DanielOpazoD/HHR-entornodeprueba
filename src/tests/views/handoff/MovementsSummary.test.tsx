import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { MovementsSummary } from '@/features/handoff/components/MovementsSummary';
import type { DailyRecord } from '@/domain/handoff/recordContracts';

const buildRecord = (): DailyRecord =>
  ({
    date: '2026-03-29',
    beds: {},
    discharges: [
      {
        id: 'd1',
        bedName: 'H1C1',
        patientName: 'Paciente Día',
        rut: '1-9',
        diagnosis: 'Dx 1',
        dischargeType: 'Domicilio',
        status: 'Vivo',
        time: '10:00',
      },
      {
        id: 'd2',
        bedName: 'H1C2',
        patientName: 'Paciente Noche',
        rut: '2-7',
        diagnosis: 'Dx 2',
        dischargeType: 'Domicilio',
        status: 'Vivo',
        time: '22:00',
      },
    ],
    transfers: [
      {
        id: 't1',
        bedName: 'H2C1',
        patientName: 'Traslado Día',
        rut: '3-5',
        diagnosis: 'Dx 3',
        evacuationMethod: 'Ambulancia',
        receivingCenter: 'Hospital',
        transferEscort: 'TENS',
        time: '11:30',
      },
    ],
    cma: [
      {
        id: 'c1',
        bedName: 'CMA1',
        patientName: 'Paciente CMA',
        rut: '4-4',
        diagnosis: 'Dx CMA',
        interventionType: 'Control',
      },
    ],
  }) as unknown as DailyRecord;

describe('MovementsSummary', () => {
  it('keeps the receiving sections when records arrive and preserves long movement details', () => {
    const record = buildRecord();
    const diagnosis = 'Descripción clínica extensa sin perder información. '.repeat(20);
    record.discharges[0].diagnosis = diagnosis;
    record.transfers[0].diagnosis = diagnosis;
    record.cma[0].diagnosis = diagnosis;
    const { rerender } = render(
      <MovementsSummary
        record={{ ...record, discharges: [], transfers: [], cma: [] }}
        selectedShift="day"
      />
    );
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map(heading => heading.textContent)).toEqual([
      'Altas',
      'Traslados',
      'Hospitalización Diurna / CMA',
    ]);

    rerender(<MovementsSummary record={record} selectedShift="day" />);

    expect(screen.getAllByRole('heading', { level: 3 })).toEqual(headings);
    for (const name of ['Altas del turno', 'Traslados del turno', 'Hospitalización diurna / CMA']) {
      const section = screen.getByRole('region', { name });
      expect(section).toHaveAttribute('tabindex', '0');
      expect(within(section).getByText(diagnosis.trim())).toBeInTheDocument();
    }
    expect(
      within(screen.getByRole('region', { name: 'Altas del turno' })).getByText('10:00')
    ).toBeInTheDocument();
  });

  it('shows only day-shift movements and no footer count', () => {
    render(<MovementsSummary record={buildRecord()} selectedShift="day" />);

    expect(screen.getByText('Paciente Día')).toBeInTheDocument();
    expect(screen.getByText('Traslado Día')).toBeInTheDocument();
    expect(screen.getByText('Paciente CMA')).toBeInTheDocument();
    expect(screen.queryByText('Paciente Noche')).not.toBeInTheDocument();
    expect(screen.queryByText(/conteo del turno/i)).not.toBeInTheDocument();
  });

  it('filters night-shift movements and keeps CMA hidden', () => {
    render(<MovementsSummary record={buildRecord()} selectedShift="night" />);

    expect(screen.getByText('Paciente Noche')).toBeInTheDocument();
    expect(screen.queryByText('Paciente Día')).not.toBeInTheDocument();
    expect(screen.queryByText('Traslado Día')).not.toBeInTheDocument();
    expect(screen.queryByText('Paciente CMA')).not.toBeInTheDocument();
    expect(screen.queryByText(/conteo del turno/i)).not.toBeInTheDocument();
  });
});
