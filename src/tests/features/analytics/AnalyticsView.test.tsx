import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { restoreConsole, suppressConsole } from '@/tests/utils/consoleTestUtils';

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
});
