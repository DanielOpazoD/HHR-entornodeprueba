import { describe, expect, it } from 'vitest';

import { classifyRayenSnapshotError } from '@/features/rayen-import/domain/rayenSnapshotErrorClassification';

describe('classifyRayenSnapshotError', () => {
  it('reconoce la pestaña de Ficha Médico que ya no puede leer (caso vivo del 02-09) y manda a recargarla', () => {
    const live =
      'No se pudo leer Rayen. Recarga la pestaña de Ficha Médico (Cmd+R) para activar la extensión y reintenta. Detalle: Failed to fetch';
    const classified = classifyRayenSnapshotError(live);

    expect(classified.reason).toBe('ficha_medico_stale');
    expect(classified.message).toContain('Recárgala (Cmd+R)');
    expect(classified.message).not.toContain('Failed to fetch');
  });

  it('un fallo de red puro también es pestaña inactiva, sin depender del texto de la extensión', () => {
    expect(classifyRayenSnapshotError('TypeError: Failed to fetch').reason).toBe(
      'ficha_medico_stale'
    );
    expect(
      classifyRayenSnapshotError('NetworkError when attempting to fetch resource.').reason
    ).toBe('ficha_medico_stale');
  });

  it('distingue pestaña ausente, Gestión de Camas y tiempo de espera', () => {
    expect(
      classifyRayenSnapshotError(
        'No hay una pestaña de Rayen (Ficha Médico) abierta. Ábrela e inicia sesión.'
      ).reason
    ).toBe('ficha_medico_unavailable');
    expect(classifyRayenSnapshotError('La sesión de Gestión de Camas venció.').reason).toBe(
      'gestion_camas_unavailable'
    );
    expect(classifyRayenSnapshotError('Tiempo de espera agotado (Ficha Médico).').reason).toBe(
      'snapshot_timeout'
    );
  });

  it('un error no reconocido conserva el texto de la extensión (acotado) bajo la causa genérica', () => {
    const unknown = classifyRayenSnapshotError(
      'La lista abierta no corresponde a la identidad clínica actual. Recarga Eloísa.'
    );
    expect(unknown.reason).toBe('snapshot_error');
    expect(unknown.message).toBe(
      'La lista abierta no corresponde a la identidad clínica actual. Recarga Eloísa.'
    );

    const long = classifyRayenSnapshotError('x'.repeat(1000));
    expect(long.message).toHaveLength(300);
  });

  it('sin texto (o un valor que no es texto) vuelve al mensaje genérico', () => {
    expect(classifyRayenSnapshotError('').message).toContain('Revisa las pestañas de Rayen');
    expect(classifyRayenSnapshotError(undefined).reason).toBe('snapshot_error');
  });
});
