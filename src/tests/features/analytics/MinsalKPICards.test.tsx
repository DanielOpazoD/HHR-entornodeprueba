import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MinsalKPICards } from '@/features/analytics/components/internal/MinsalKPICards';
import type { MinsalStatistics } from '@/types/minsalTypes';

const stats: MinsalStatistics = {
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
};

describe('MinsalKPICards', () => {
  it('uses explicit period labels across the main KPI cards', () => {
    render(<MinsalKPICards stats={stats} />);

    expect(screen.getByText('Ocupación del período')).toBeInTheDocument();
    expect(screen.getByText('Promedio del rango seleccionado')).toBeInTheDocument();
    expect(screen.getByText('Estada media de egresos')).toBeInTheDocument();
    expect(screen.getByText('Σ días de estada / egresos del rango')).toBeInTheDocument();
    expect(screen.getByText('Egresos del período')).toBeInTheDocument();
    expect(
      screen.getByText('Total acumulado del rango seleccionado · 36 vivos, 2 trasl.')
    ).toBeInTheDocument();
    expect(screen.getByText('Mortalidad del período')).toBeInTheDocument();
    expect(
      screen.getByText('Fallecidos sobre egresos acumulados del rango · 2 fallecidos')
    ).toBeInTheDocument();
    expect(screen.getByText('Rotación del período')).toBeInTheDocument();
    expect(screen.getByText('Índice estimado sobre el acumulado del rango')).toBeInTheDocument();
    expect(screen.getByText('Días cama del período')).toBeInTheDocument();
    expect(
      screen.getByText('Acumulado ocupado dentro del rango seleccionado · 558 disponibles')
    ).toBeInTheDocument();
    expect(screen.getByText('69.9%')).toBeInTheDocument();
  });
});
