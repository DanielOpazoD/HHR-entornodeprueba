import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ recordOperationalTelemetry: vi.fn() }));

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: mocks.recordOperationalTelemetry,
}));

import { classifyRayenSnapshotError } from '@/features/rayen-import/domain/rayenSnapshotErrorClassification';
import { reportRayenSyncTerminal } from '@/features/rayen-import/observability/rayenSyncDiagnostics';
import { sanitizeOperationalTelemetryContextValues } from '@/services/observability/operationalTelemetryPrivacy';

const WRAP =
  'No se pudo leer Rayen. Recarga la pestaña de Ficha Médico (Cmd+R) para activar la extensión y reintenta. Detalle: ';

/**
 * Messages the extension really produces (extension/*.js), with the check each one names. Ficha
 * Médico's own causes stay `other`: the failure reason already tells them apart.
 */
const EXTENSION_MESSAGES: [string, string][] = [
  [
    'Una fuente se desconectó durante la captura. La pestaña de Gestión de Camas no respondió a la comprobación.',
    'gc_after_capture',
  ],
  [
    'Una fuente se desconectó durante la captura. La sesión de Ficha Médico venció.',
    'ficha_after_capture',
  ],
  ['La pestaña de Gestión de Camas no respondió a la comprobación.', 'gc_tab_unresponsive'],
  [
    'Abre una pestaña nueva de Gestión de Camas: el puente interno no respondió.',
    'gc_tab_unresponsive',
  ],
  ['El relé de Gestión de Camas perdió conexión con la extensión.', 'gc_tab_unresponsive'],
  ['Tiempo de espera agotado consultando Gestión de Camas.', 'gc_tab_unresponsive'],
  [
    'Abre una pestaña nueva de Gestión de Camas: la pestaña actual está desactualizada.',
    'gc_tab_outdated',
  ],
  ['La sesión de Gestión de Camas venció. Vuelve a conectarla.', 'gc_session_expired'],
  ['Inicia sesión en la ventana oficial de Gestión de Camas.', 'gc_session_expired'],
  ['La sesión cambió durante la descarga. Reintenta la operación.', 'gc_session_changed'],
  ['Gestión de Camas no está conectada.', 'gc_session_missing'],
  [
    'Gestión de Camas está abierta, pero su sesión todavía no está disponible.',
    'gc_session_missing',
  ],
  ['Abre Gestión de Camas e inicia sesión para sincronizar.', 'gc_session_missing'],
  ['Sin token de Gestión de Camas. Recarga la pestaña e inicia sesión.', 'gc_session_missing'],
  ['Falló la descarga del reporte: Tiempo de espera agotado.', 'gc_report_failed'],
  ['El servidor de reportes respondió HTTP 500.', 'gc_report_failed'],
  ['Gestión de Camas no entregó el informe de egresos.', 'gc_report_failed'],
  ['Ficha Médico y Gestión de Camas no corresponden al mismo establecimiento.', 'other'],
  ['Las fuentes fueron capturadas con demasiado desfase; vuelve a sincronizar.', 'other'],
  ['No hay una pestaña de Rayen disponible. Abre Ficha Médico e inicia sesión.', 'other'],
  [`${WRAP}La pestaña de Ficha Médico ya no puede leer datos (fallo de red).`, 'other'],
  [`${WRAP}La sesión clínica de Ficha Médico venció.`, 'other'],
  ['Ficha Médico entregó un censo parcial; no se inició la sincronización.', 'other'],
  [`${WRAP}Failed to fetch`, 'other'],
  ['Algo que la extensión nunca dijo antes.', 'other'],
];

describe('which Eloísa capture check failed', () => {
  it.each(EXTENSION_MESSAGES)('%s → %s', (message, check) => {
    expect(classifyRayenSnapshotError(message).check).toBe(check);
  });

  it('names a Ficha Médico relay that did not answer from its stage', () => {
    expect(classifyRayenSnapshotError('x', 'ficha_main_relay').check).toBe('ficha_relay_timeout');
    expect(classifyRayenSnapshotError('x', 'ficha_tab_relay').check).toBe('ficha_relay_timeout');
  });
});

describe('failed run telemetry', () => {
  beforeEach(() => mocks.recordOperationalTelemetry.mockReset());

  it('carries the failed check as a bounded code, never the message', () => {
    reportRayenSyncTerminal(
      { id: 'run-7', startedAt: '2026-11-06T20:28:16.000Z' },
      'failed',
      { failureReason: 'gestion_camas_unavailable', captureCheck: 'gc_after_capture' },
      '2026-11-06T20:28:35.000Z'
    );

    const [event] = mocks.recordOperationalTelemetry.mock.calls[0];
    expect(event.context).toMatchObject({
      failureReason: 'gestion_camas_unavailable',
      captureCheck: 'gc_after_capture',
    });
  });

  it('keeps known check codes and drops anything else on the way out', () => {
    expect(
      sanitizeOperationalTelemetryContextValues({ captureCheck: 'gc_tab_unresponsive' }).context
    ).toEqual({ captureCheck: 'gc_tab_unresponsive' });
    expect(
      sanitizeOperationalTelemetryContextValues({ captureCheck: 'La pestaña no respondió' }).context
    ).toEqual({});
  });
});
