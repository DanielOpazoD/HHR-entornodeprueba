import { describe, expect, it } from 'vitest';
import {
  presentRayenCoverage,
  rayenPrimaryActionLabel,
} from '@/features/rayen-import/components/rayenSyncPresentation';

describe('rayen sync presentation', () => {
  it('keeps legacy, complete, patient-error and source-error coverage distinguishable', () => {
    expect(presentRayenCoverage(undefined, true).label).toBe(
      'No disponible en sincronizaciones antiguas'
    );
    expect(presentRayenCoverage(undefined, true, true)).toEqual({
      label: 'Enriquecimiento pendiente',
      tone: 'warning',
    });
    expect(
      presentRayenCoverage(
        { total: 3, completed: 3, errors: 0, sourceErrors: 0, completedAt: 'now' },
        true
      )
    ).toEqual({ label: '3/3 completa', tone: 'success' });
    expect(
      presentRayenCoverage(
        { total: 3, completed: 2, errors: 1, sourceErrors: 2, completedAt: 'now' },
        true
      ).label
    ).toBe('2/3 · 1 pendiente');
    expect(
      presentRayenCoverage(
        { total: 3, completed: 3, errors: 0, sourceErrors: 1, completedAt: 'now' },
        true
      ).label
    ).toBe('3/3 · fuente parcial');
  });

  it('names the action the current extension state can actually perform', () => {
    expect(rayenPrimaryActionLabel('checking', false)).toBe('Comprobando…');
    expect(rayenPrimaryActionLabel('ready', false)).toBe('Sincronizar');
    expect(rayenPrimaryActionLabel('degraded', false)).toBe('Sincronizar parcial');
    expect(rayenPrimaryActionLabel('blocked', false)).toBe('Revisar Ficha Médico');
    expect(rayenPrimaryActionLabel('incompatible', false)).toBe('Actualizar extensión');
    expect(rayenPrimaryActionLabel('offline', false)).toBe('Comprobar conexión');
    expect(rayenPrimaryActionLabel('ready', true)).toBe('Sincronizando…');
  });
});
