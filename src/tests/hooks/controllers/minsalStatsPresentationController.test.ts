// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveDisplayedMinsalStats } from '@/features/analytics/controllers/minsalStatsPresentationController';
import type { MinsalStatistics } from '@/features/analytics/types/minsalTypes';

const buildStats = (overrides: Partial<MinsalStatistics> = {}): MinsalStatistics => ({
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
  ...overrides,
});

describe('resolveDisplayedMinsalStats', () => {
  it('prefers local stats when both local and remote are available', () => {
    const localStats = buildStats({ tasaOcupacion: 69.9 });
    const remoteStats = buildStats({ tasaOcupacion: 30.1 });

    const resolved = resolveDisplayedMinsalStats({ localStats, remoteStats });

    expect(resolved?.tasaOcupacion).toBe(69.9);
  });

  it('falls back to remote stats when local stats are unavailable', () => {
    const remoteStats = buildStats({ tasaOcupacion: 30.1 });

    const resolved = resolveDisplayedMinsalStats({ localStats: null, remoteStats });

    expect(resolved?.tasaOcupacion).toBe(30.1);
  });

  it('returns null when neither source is available', () => {
    const resolved = resolveDisplayedMinsalStats({ localStats: null, remoteStats: null });

    expect(resolved).toBeNull();
  });
});
