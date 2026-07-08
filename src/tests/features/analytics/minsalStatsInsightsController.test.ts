import { describe, expect, it } from 'vitest';

import {
  buildAnalyticsDataQualityIssues,
  buildMinsalComparisonSummary,
  resolvePreviousMinsalPeriod,
} from '@/services/calculations/minsal/minsalStatsInsights';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { MinsalStatistics } from '@/types/minsalTypes';

const buildStats = (overrides: Partial<MinsalStatistics>): MinsalStatistics => ({
  periodStart: '2026-03-08',
  periodEnd: '2026-03-10',
  totalDays: 3,
  calendarDays: 3,
  diasCamaDisponibles: 30,
  diasCamaOcupados: 15,
  tasaOcupacion: 50,
  promedioDiasEstada: 4,
  egresosTotal: 6,
  egresosVivos: 5,
  egresosFallecidos: 1,
  egresosTraslados: 0,
  mortalidadHospitalaria: 16.7,
  indiceRotacion: 2,
  pacientesActuales: 5,
  camasOcupadas: 5,
  camasBloqueadas: 0,
  camasDisponibles: 10,
  camasLibres: 5,
  tasaOcupacionActual: 50,
  porEspecialidad: [],
  cma: {
    total: 4,
    cirugiaMayorAmbulatoria: 3,
    procedimientoMedicoAmbulatorio: 1,
    porEspecialidad: [],
    pacientesList: [],
  },
  ...overrides,
});

describe('minsalStatsInsightsController', () => {
  it('resolves the immediately previous equal-length calendar period', () => {
    expect(resolvePreviousMinsalPeriod('2026-03-08', '2026-03-10')).toEqual({
      previousPeriodStart: '2026-03-05',
      previousPeriodEnd: '2026-03-07',
    });
  });

  it('builds comparison metrics with absolute and relative deltas', () => {
    const comparison = buildMinsalComparisonSummary(
      buildStats({ periodStart: '2026-03-08', periodEnd: '2026-03-10', tasaOcupacion: 60 }),
      buildStats({
        periodStart: '2026-03-05',
        periodEnd: '2026-03-07',
        tasaOcupacion: 50,
        egresosTotal: 3,
        cma: {
          total: 2,
          cirugiaMayorAmbulatoria: 1,
          procedimientoMedicoAmbulatorio: 1,
          porEspecialidad: [],
          pacientesList: [],
        },
      })
    );

    expect(comparison.previousPeriodStart).toBe('2026-03-05');
    expect(comparison.tasaOcupacion).toEqual({
      current: 60,
      previous: 50,
      absoluteDelta: 10,
      relativeDelta: 20,
      direction: 'up',
    });
    expect(comparison.egresosTotal.absoluteDelta).toBe(3);
    expect(comparison.cmaTotal.relativeDelta).toBe(100);
  });

  it('detects non-blocking statistical data quality issues with clinical navigation dates', () => {
    const records = [
      {
        date: '2026-03-10',
        beds: {
          R1: {
            patientName: 'Paciente Sin Especialidad',
            rut: '11.111.111-1',
            pathology: 'Diagnóstico',
            specialty: '',
          },
          R2: {
            patientName: 'Paciente Libre',
            rut: '22.222.222-2',
            pathology: 'Diagnóstico',
            specialty: 'Cardiología',
          },
        },
        discharges: [
          {
            id: 'd-1',
            patientName: 'Alta Sin Fecha',
            rut: '33.333.333-3',
            diagnosis: 'Diagnóstico',
            specialty: 'Cirugía',
            status: 'Vivo',
            admissionDate: '2026-03-15',
          },
          {
            id: 'd-2',
            patientName: 'Alta Duplicada',
            rut: '44.444.444-4',
            diagnosis: 'Diagnóstico',
            specialty: 'Cirugía',
            status: 'Vivo',
          },
          {
            id: 'd-3',
            patientName: 'Alta Duplicada 2',
            rut: '44.444.444-4',
            diagnosis: 'Diagnóstico',
            specialty: 'Cirugía',
            status: 'Vivo',
          },
        ],
        transfers: [
          {
            id: 't-1',
            patientName: 'Traslado Sin Fecha',
            rut: '55.555.555-5',
            diagnosis: 'Diagnóstico',
            specialty: '',
          },
        ],
        cma: [
          {
            id: 'cma-1',
            patientName: 'CMA Sin Tipo',
            rut: '66.666.666-6',
            diagnosis: 'Diagnóstico',
            specialty: 'Dermatología',
          },
        ],
      } as unknown as DailyRecord,
    ];

    const issues = buildAnalyticsDataQualityIssues(records, {
      specialtyGroupingMode: 'group-other',
    });

    expect(issues.map(issue => issue.title)).toEqual(
      expect.arrayContaining([
        'Paciente sin especialidad',
        'CMA/PMA sin tipo de intervención',
        'Egreso sin fecha explícita',
        'Traslado sin fecha explícita',
        'Estadía imposible',
        'Duplicado por RUT y fecha',
        'Especialidad libre agrupada como Otro',
      ])
    );
    expect(issues.every(issue => issue.date === '2026-03-10' || issue.date === undefined)).toBe(
      true
    );
  });
});
