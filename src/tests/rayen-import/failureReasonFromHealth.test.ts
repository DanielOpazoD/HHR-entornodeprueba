import { describe, expect, it } from 'vitest';

import { failureReasonFromHealth } from '@/features/rayen-import/hooks/useRayenSyncAudit';
import type { RayenExtensionHealthState } from '@/features/rayen-import/hooks/useRayenExtensionHealth';

const blocked = (
  fichaMedico: { status: 'ready' | 'missing' | 'stale'; message: string },
  gestionCamas: { status: 'ready' | 'missing' | 'stale'; message: string } = {
    status: 'ready',
    message: 'Gestión de Camas conectada.',
  }
): RayenExtensionHealthState =>
  ({
    connection: 'blocked',
    canSync: false,
    message: fichaMedico.message,
    report: {
      version: '0.48.4',
      protocolVersion: 5,
      capabilities: [],
      checkedAt: '2026-09-02T13:37:00.000Z',
      fichaMedico,
      gestionCamas,
    },
  }) as unknown as RayenExtensionHealthState;

describe('failureReasonFromHealth', () => {
  it('una pestaña de Ficha Médico con lectura bloqueada por red es «stale», no «no disponible»', () => {
    expect(
      failureReasonFromHealth(
        blocked({
          status: 'stale',
          message:
            'Ficha Médico no puede leer datos desde esta pestaña (fallo de red al consultar Eloísa). Recarga la pestaña (Cmd+R).',
        })
      )
    ).toBe('ficha_medico_stale');
  });

  it('una sesión clínica ausente o una pestaña sin relé siguen siendo «no disponible»', () => {
    expect(
      failureReasonFromHealth(
        blocked({
          status: 'stale',
          message: 'La sesión clínica de Ficha Médico no está disponible.',
        })
      )
    ).toBe('ficha_medico_unavailable');
    expect(
      failureReasonFromHealth(
        blocked({
          status: 'missing',
          message: 'Abre Ficha Médico e inicia sesión para sincronizar.',
        })
      )
    ).toBe('ficha_medico_unavailable');
  });

  it('una Ficha Médico lista pero por vencer se archiva como Ficha Médico, no como Gestión de Camas', () => {
    const health = {
      ...blocked({ status: 'ready', message: 'Ficha Médico disponible. Sesión clínica vigente.' }),
      blockedBy: 'fichaMedico' as const,
      message:
        'La sesión de Ficha Médico vence en ~3 min y no alcanzaría a cubrir la sincronización.',
    };
    expect(failureReasonFromHealth(health)).toBe('ficha_medico_unavailable');
  });

  it('con Ficha Médico lista, el bloqueo es de Gestión de Camas', () => {
    expect(
      failureReasonFromHealth(
        blocked(
          { status: 'ready', message: 'Ficha Médico disponible. Sesión clínica vigente.' },
          { status: 'stale', message: 'La sesión de Gestión de Camas venció.' }
        )
      )
    ).toBe('gestion_camas_unavailable');
  });

  it('un lector de otra versión (relay 0.48.8) se archiva como Ficha Médico «stale»', () => {
    expect(
      failureReasonFromHealth(
        blocked({
          status: 'stale',
          message:
            'Recarga la pestaña de Ficha Médico (Cmd+R): el lector cargado es de una versión anterior de la extensión.',
        })
      )
    ).toBe('ficha_medico_stale');
  });
});
