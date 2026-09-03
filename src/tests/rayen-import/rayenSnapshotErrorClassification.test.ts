import { describe, expect, it } from 'vitest';

import { classifyRayenSnapshotError } from '@/features/rayen-import/domain/rayenSnapshotErrorClassification';

/**
 * Los strings de estos tests son los que producen de verdad la extensión y su
 * transporte (fichamedico-transport-runtime.js envuelve TODO error del lector
 * con el mismo prefijo + «Detalle: …»). Clasificar sobre el envoltorio
 * etiquetaba cualquier fallo como pestaña inactiva.
 */
const WRAP =
  'No se pudo leer Rayen. Recarga la pestaña de Ficha Médico (Cmd+R) para activar la extensión y reintenta. Detalle: ';

describe('classifyRayenSnapshotError', () => {
  it('pestaña de Ficha Médico que ya no puede leer (caso vivo del 02-09): recargarla, conservando el detalle', () => {
    const classified = classifyRayenSnapshotError(`${WRAP}Failed to fetch`);

    expect(classified.reason).toBe('ficha_medico_stale');
    expect(classified.message).toContain('Recárgala (Cmd+R)');
    expect(classified.message).toContain('Detalle: Failed to fetch');
  });

  it('el mismo fallo, ya descrito por la extensión con el endpoint, y el mensaje de salud de lectura bloqueada', () => {
    expect(
      classifyRayenSnapshotError(
        `${WRAP}Failed to fetch al consultar https://fichamedicoback.rayensalud.cl/encounter/list/filter`
      ).reason
    ).toBe('ficha_medico_stale');
    expect(
      classifyRayenSnapshotError(
        'Ficha Médico no puede leer datos desde esta pestaña (fallo de red al consultar Eloísa). Recarga la pestaña (Cmd+R).'
      ).reason
    ).toBe('ficha_medico_stale');
  });

  it('un 500 del backend o una lista ajena a la identidad NO son pestaña inactiva: causa genérica con el detalle real', () => {
    const http = classifyRayenSnapshotError(`${WRAP}500 en /encounter/list/filter`);
    expect(http.reason).toBe('snapshot_error');
    expect(http.message).toBe('500 en /encounter/list/filter');

    const identity = classifyRayenSnapshotError(
      `${WRAP}La lista abierta no corresponde a la identidad clínica actual. Recarga Eloísa.`
    );
    expect(identity.reason).toBe('snapshot_error');
    expect(identity.message).toBe(
      'La lista abierta no corresponde a la identidad clínica actual. Recarga Eloísa.'
    );
  });

  it('sesión clínica ausente o vencida en Ficha Médico: causa «no disponible» con la instrucción de la extensión', () => {
    const missing = classifyRayenSnapshotError(
      `${WRAP}La sesión clínica de Eloísa no está disponible. Inicia sesión y reintenta.`
    );
    expect(missing.reason).toBe('ficha_medico_unavailable');
    expect(missing.message).toBe(
      'La sesión clínica de Eloísa no está disponible. Inicia sesión y reintenta.'
    );
    expect(
      classifyRayenSnapshotError(
        `${WRAP}La sesión clínica cambió o venció. Inicia sesión nuevamente antes de continuar.`
      ).reason
    ).toBe('ficha_medico_unavailable');
    expect(
      classifyRayenSnapshotError(
        'No hay una pestaña de Rayen (Ficha Médico) abierta. Ábrela e inicia sesión.'
      ).reason
    ).toBe('ficha_medico_unavailable');
  });

  it('Gestión de Camas: su sesión, su descarga de reportes (aunque falle en red) y su timeout no mandan a recargar Ficha Médico', () => {
    expect(classifyRayenSnapshotError('La sesión de Gestión de Camas venció.').reason).toBe(
      'gestion_camas_unavailable'
    );
    const report = classifyRayenSnapshotError('Falló la descarga del reporte: Failed to fetch');
    expect(report.reason).toBe('gestion_camas_unavailable');
    expect(report.message).not.toContain('Ficha Médico');
    expect(
      classifyRayenSnapshotError('Tiempo de espera agotado consultando Gestión de Camas.').reason
    ).toBe('snapshot_timeout');
    expect(
      classifyRayenSnapshotError(
        'La pestaña de Gestión de Camas no respondió dentro del tiempo esperado.'
      ).reason
    ).toBe('snapshot_timeout');
  });

  it('establecimientos distintos: causa genérica con el texto exacto de la extensión (el remedio no es «conectar GC»)', () => {
    const classified = classifyRayenSnapshotError(
      'Ficha Médico y Gestión de Camas no corresponden al mismo establecimiento.'
    );
    expect(classified.reason).toBe('snapshot_error');
    expect(classified.message).toBe(
      'Ficha Médico y Gestión de Camas no corresponden al mismo establecimiento.'
    );
  });

  it('timeout del mundo principal de Ficha Médico envuelto por el transporte', () => {
    const classified = classifyRayenSnapshotError(
      `${WRAP}Tiempo de espera agotado (Ficha Médico).`
    );
    expect(classified.reason).toBe('snapshot_timeout');
    expect(classified.message).toContain('Detalle: Tiempo de espera agotado (Ficha Médico).');
  });

  it('acota los mensajes largos en un límite de palabra y vuelve al genérico sin texto', () => {
    const long = classifyRayenSnapshotError(`${WRAP}${'palabra '.repeat(80)}`);
    expect(long.message.length).toBeLessThanOrEqual(301);
    expect(long.message.endsWith('…')).toBe(true);
    expect(long.message).not.toMatch(/palabr…$/);

    expect(classifyRayenSnapshotError('').message).toContain('Revisa las pestañas de Rayen');
    expect(classifyRayenSnapshotError(undefined).reason).toBe('snapshot_error');
  });

  it('un lector de otra versión (inject que sobrevivió a la recarga de la extensión, 0.48.8) es pestaña inactiva', () => {
    const classified = classifyRayenSnapshotError(
      `${WRAP}Recarga la pestaña de Ficha Médico (Cmd+R): el lector cargado es de una versión anterior de la extensión.`
    );

    expect(classified.reason).toBe('ficha_medico_stale');
    expect(classified.message).toContain('versión anterior de la extensión');
  });
});
