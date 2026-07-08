import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CmaStatsSection } from '@/features/analytics/components/internal/CmaStatsSection';
import type { CmaStatistics } from '@/types/minsalTypes';

const cma: CmaStatistics = {
  total: 2,
  cirugiaMayorAmbulatoria: 1,
  procedimientoMedicoAmbulatorio: 1,
  porEspecialidad: [
    {
      specialty: 'Cirugía',
      total: 2,
      cirugiaMayorAmbulatoria: 1,
      procedimientoMedicoAmbulatorio: 1,
      pacientesList: [
        {
          name: 'Paciente CMA',
          rut: '11.111.111-1',
          diagnosis: 'Colelitiasis',
          date: '2026-03-31',
          interventionType: 'Cirugía Mayor Ambulatoria',
          eventTime: '12:30',
          originalSpecialty: 'Dermatología',
          reportingSpecialty: 'Cirugía',
          reportingSpecialtySource: 'manual',
        },
      ],
    },
  ],
  pacientesList: [
    {
      name: 'Paciente CMA',
      rut: '11.111.111-1',
      diagnosis: 'Colelitiasis',
      date: '2026-03-31',
      interventionType: 'Cirugía Mayor Ambulatoria',
      eventTime: '12:30',
      originalSpecialty: 'Dermatología',
      reportingSpecialty: 'Cirugía',
      reportingSpecialtySource: 'manual',
    },
  ],
};

describe('CmaStatsSection', () => {
  it('opens a clinical drilldown with patient, CMA type, time and reporting specialty', () => {
    render(<CmaStatsSection cma={cma} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle total CMA/PMA' }));

    expect(screen.getByText('Detalle: CMA/PMA')).toBeInTheDocument();
    expect(screen.getByText('Paciente CMA')).toBeInTheDocument();
    expect(screen.getByText('Colelitiasis')).toBeInTheDocument();
    expect(screen.getAllByText('Cirugía Mayor Ambulatoria').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('12:30')).toBeInTheDocument();
    expect(screen.getByText('Dermatología')).toBeInTheDocument();
    expect(screen.getAllByText('Cirugía').length).toBeGreaterThanOrEqual(1);
  });
});
