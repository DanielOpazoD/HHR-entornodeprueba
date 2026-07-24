import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { restoreConsole, suppressConsole } from '@/tests/utils/consoleTestUtils';

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({
    notify: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    role: 'admin',
    currentUser: { role: 'admin' },
    isAuthenticated: true,
  }),
}));

vi.mock('@/hooks/useMinsalStats', () => ({
  useMinsalStats: () => ({
    stats: {
      periodStart: '2026-03-01',
      periodEnd: '2026-03-31',
      totalDays: 31,
      calendarDays: 31,
      diasCamaDisponibles: 558,
      diasCamaOcupados: 390,
      tasaOcupacion: 69.9,
      promedioDiasEstada: 4.2,
      egresosTotal: 40,
      egresosVivos: 36,
      egresosFallecidos: 2,
      egresosTraslados: 2,
      mortalidadHospitalaria: 5,
      indiceRotacion: 2.1,
      pacientesActuales: 13,
      camasOcupadas: 13,
      camasBloqueadas: 0,
      camasDisponibles: 18,
      camasLibres: 5,
      tasaOcupacionActual: 72.2,
      porEspecialidad: [],
      cma: {
        total: 3,
        cirugiaMayorAmbulatoria: 2,
        procedimientoMedicoAmbulatorio: 1,
        porEspecialidad: [
          {
            specialty: 'Traumatología',
            total: 2,
            cirugiaMayorAmbulatoria: 2,
            procedimientoMedicoAmbulatorio: 0,
            pacientesList: [
              {
                name: 'Paciente CMA',
                rut: '11.111.111-1',
                diagnosis: 'Colelitiasis',
                date: '2026-03-31',
                interventionType: 'Cirugía Mayor Ambulatoria',
                eventTime: '12:30',
                originalSpecialty: 'Traumatología',
                reportingSpecialty: 'Traumatología',
              },
            ],
          },
          {
            specialty: 'Med Interna',
            total: 1,
            cirugiaMayorAmbulatoria: 0,
            procedimientoMedicoAmbulatorio: 1,
            pacientesList: [],
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
            originalSpecialty: 'Traumatología',
            reportingSpecialty: 'Traumatología',
          },
        ],
      },
    },
    trendData: [
      {
        date: '2026-03-31',
        ocupadas: 13,
        disponibles: 18,
        bloqueadas: 0,
        egresos: 0,
        fallecidos: 0,
        tasaOcupacion: 72.2,
      },
    ],
    allRecords: [],
    dateRange: { preset: 'currentMonth', currentYearMonth: 3 },
    setPreset: vi.fn(),
    setCustomRange: vi.fn(),
    setCurrentYearMonth: vi.fn(),
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    comparison: {
      periodStart: '2026-03-01',
      periodEnd: '2026-03-31',
      previousPeriodStart: '2026-01-29',
      previousPeriodEnd: '2026-02-28',
      tasaOcupacion: {
        current: 69.9,
        previous: 60,
        absoluteDelta: 9.9,
        relativeDelta: 16.5,
        direction: 'up',
      },
      egresosTotal: {
        current: 40,
        previous: 35,
        absoluteDelta: 5,
        relativeDelta: 14.3,
        direction: 'up',
      },
      promedioDiasEstada: {
        current: 4.2,
        previous: 4,
        absoluteDelta: 0.2,
        relativeDelta: 5,
        direction: 'up',
      },
      cmaTotal: {
        current: 3,
        previous: 1,
        absoluteDelta: 2,
        relativeDelta: 200,
        direction: 'up',
      },
      mortalidadHospitalaria: {
        current: 5,
        previous: 4,
        absoluteDelta: 1,
        relativeDelta: 25,
        direction: 'up',
      },
    },
    dataQualityIssues: [
      {
        id: 'issue-1',
        severity: 'advertencia',
        title: 'Egreso sin fecha explícita',
        description: 'El cálculo usa fecha del censo.',
        date: '2026-03-31',
      },
    ],
    reclassifications: [
      {
        date: '2026-03-31',
        movementKind: 'discharge',
        movementId: 'd-1',
        specialty: 'Cirugía',
      },
    ],
    saveReclassification: vi.fn(),
    isSavingReclassification: false,
  }),
}));

import { AnalyticsView } from '@/features/analytics/public';

describe('AnalyticsView', () => {
  it('distinguishes occupancy of the period from current occupancy', () => {
    const consoleSpies = suppressConsole(['error', 'warn']);

    try {
      render(<AnalyticsView />);

      expect(screen.getByText('Ocupación del período')).toBeInTheDocument();
      expect(screen.getByText('69.9%')).toBeInTheDocument();
      expect(screen.getByText('Comparación con período anterior')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: 'Hospitalización' }));

      expect(screen.getByText('Tendencia diaria de ocupación')).toBeInTheDocument();
      expect(screen.getByText('Serie diaria del rango seleccionado')).toBeInTheDocument();
      expect(screen.getByText('Último registro disponible')).toBeInTheDocument();
      expect(
        screen.getByText('Último registro disponible del rango seleccionado')
      ).toBeInTheDocument();
      expect(screen.getByText('Ocupación del último registro')).toBeInTheDocument();
      expect(screen.getByText('72.2%')).toBeInTheDocument();
    } finally {
      restoreConsole(consoleSpies);
    }
  });

  it('shows a separated CMA section and compact specialty reporting controls', () => {
    const consoleSpies = suppressConsole(['error', 'warn']);

    try {
      render(<AnalyticsView />);

      fireEvent.click(screen.getByRole('tab', { name: 'CMA/PMA' }));

      expect(screen.getByText('CMA / Hospitalización diurna')).toBeInTheDocument();
      expect(screen.getByText('Eventos CMA/PMA')).toBeInTheDocument();
      expect(screen.getByText('Cirugía Mayor Ambulatoria')).toBeInTheDocument();
      expect(screen.getByText('Procedimiento Médico Ambulatorio')).toBeInTheDocument();
      expect(screen.getByText('Traumatología')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: 'Especialidades' }));

      expect(screen.getByRole('button', { name: 'Agrupar otras' })).toBeInTheDocument();
      expect(screen.getByText('Reclasificación estadística')).toBeInTheDocument();
    } finally {
      restoreConsole(consoleSpies);
    }
  });

  it('renders professional tabs and the data quality panel in traceability', () => {
    const consoleSpies = suppressConsole(['error', 'warn']);

    try {
      render(<AnalyticsView />);

      expect(screen.getByRole('tab', { name: 'Resumen' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Hospitalización' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'CUDYR / UPC' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'UPC clínico' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Traslados' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'CMA/PMA' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Especialidades' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Trazabilidad' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: 'Trazabilidad' }));

      expect(screen.getByText('Calidad de datos')).toBeInTheDocument();
      expect(screen.getByText('Egreso sin fecha explícita')).toBeInTheDocument();
      expect(screen.getByText('Reclasificaciones vigentes')).toBeInTheDocument();
    } finally {
      restoreConsole(consoleSpies);
    }
  });

  it('exposes the CUDYR and UPC analysis as a dedicated statistics section', () => {
    render(<AnalyticsView />);

    fireEvent.click(screen.getByRole('tab', { name: 'CUDYR / UPC' }));

    expect(screen.getByText('Sin evaluaciones CUDYR analizables')).toBeInTheDocument();
  });

  it('exposes transfer analytics as a dedicated statistics section', () => {
    render(<AnalyticsView />);

    fireEvent.click(screen.getByRole('tab', { name: 'Traslados' }));

    expect(screen.getByText('Sin traslados en el período')).toBeInTheDocument();
  });

  it('exposes structured UPC clinical analytics as a dedicated section', () => {
    render(<AnalyticsView />);

    fireEvent.click(screen.getByRole('tab', { name: 'UPC clínico' }));

    expect(screen.getByText('Sin pacientes UPC clasificables')).toBeInTheDocument();
  });
});
