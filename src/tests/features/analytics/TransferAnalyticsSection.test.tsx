import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TransferAnalyticsSection } from '@/features/analytics/components/internal/TransferAnalyticsSection';
import type { DailyRecord } from '@/features/analytics/contracts/analyticsDailyRecordContracts';
import type { TransferData } from '@/types/domain/movements';

const transfer = (id: string, evacuationMethod: string, evacuationMethodOther?: string) =>
  ({
    id,
    bedName: 'R1',
    bedId: 'R1',
    bedType: 'Cama',
    patientName: `Paciente ${id}`,
    rut: '11.111.111-1',
    diagnosis: 'Neumonía grave',
    time: '10:00',
    evacuationMethod,
    evacuationMethodOther,
    receivingCenter: 'Hospital Salvador',
  }) as TransferData;

const record = {
  date: '2026-03-10',
  beds: {},
  discharges: [],
  transfers: [
    transfer('1', 'Avión comercial'),
    transfer('2', 'Aerocardal'),
    transfer('3', 'Otro', 'Avión Armada'),
    transfer('4', 'Otro', 'Barco de apoyo'),
  ],
  cma: [],
} as DailyRecord;

describe('TransferAnalyticsSection', () => {
  it('renders transfer percentages, air-ambulance providers and daily detail', () => {
    render(<TransferAnalyticsSection records={[record]} />);

    expect(screen.getByTestId('transfer-analytics')).toBeInTheDocument();
    expect(screen.getByText('Análisis de traslados')).toBeInTheDocument();
    expect(screen.getByText('Distribución por modalidad')).toBeInTheDocument();
    expect(screen.getByText('Aviones ambulancia por operador')).toBeInTheDocument();
    expect(screen.getAllByText('Aerocardal').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('FACH')).toBeInTheDocument();
    expect(screen.getByText('Armada')).toBeInTheDocument();
    expect(screen.getByText('Otras empresas')).toBeInTheDocument();
    expect(screen.getByText('Fuerzas Armadas')).toBeInTheDocument();
    expect(screen.getByText('10-03-2026')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Otros del 10-03-2026: 1. Ver detalle' }));

    expect(screen.getByText('Otros traslados del 10-03-2026')).toBeInTheDocument();
    expect(screen.getByText('Paciente 4')).toBeInTheDocument();
    expect(screen.getByText('11.111.111-1')).toBeInTheDocument();
    expect(screen.getByText('Neumonía grave')).toBeInTheDocument();
    expect(screen.getByText('Barco de apoyo')).toBeInTheDocument();
    expect(screen.getByText('Valor ingresado en “Otro”')).toBeInTheDocument();
  });

  it('renders an explicit empty state', () => {
    render(<TransferAnalyticsSection records={[]} />);
    expect(screen.getByText('Sin traslados en el período')).toBeInTheDocument();
  });
});
