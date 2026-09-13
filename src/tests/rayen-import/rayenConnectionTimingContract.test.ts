// @vitest-environment node
/**
 * Contrato de tiempos de la conexión Eloísa.
 *
 * La estabilidad de la conexión depende de números que viven en dos bases de código
 * distintas: los presupuestos de sondeo y el latido están en `extension/`, mientras que
 * el presupuesto de espera y el arriendo de confianza están en la aplicación. Cada vez
 * que esa relación se rompió, el síntoma fue el mismo: HHR mostraba «desconectado»
 * aunque la extensión y las pestañas estuvieran perfectamente sanas.
 *
 * Estas pruebas fijan la relación, no los valores: se pueden ajustar los números
 * mientras las desigualdades se mantengan.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  RAYEN_EXTENSION_PASSIVE_HEALTH_TIMEOUT_MS,
  RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS,
} from '@/features/rayen-import/bridge/extensionHealthBridge';
import {
  RAYEN_EXTENSION_HEALTH_LEASE_MS,
  RAYEN_EXTENSION_HEALTH_RECOVERY_BASE_DELAY_MS,
  RAYEN_EXTENSION_HEALTH_RECOVERY_MAX_DELAY_MS,
} from '@/features/rayen-import/hooks/useRayenExtensionHealth';

const readExtensionSource = (file: string): string =>
  readFileSync(path.resolve('extension', file), 'utf8');

const readNumericConstant = (source: string, name: string): number => {
  const match = source.match(new RegExp(`${name}\\s*=\\s*([\\d_]+)`));
  expect(match, `No se encontró la constante ${name} en la extensión.`).toBeTruthy();
  return Number(String(match?.[1]).replace(/_/g, ''));
};

const backgroundSource = readExtensionSource('background.js');
const heartbeatSource = readExtensionSource('health-heartbeat-runtime.js');

const healthProbeTimeoutMs = readNumericConstant(backgroundSource, 'HEALTH_PROBE_TIMEOUT_MS');
const heartbeatPeriodMinutes = readNumericConstant(heartbeatSource, 'periodMinutes');
const heartbeatPeriodMs = heartbeatPeriodMinutes * 60_000;

describe('contrato de tiempos de la conexión Eloísa', () => {
  it('nunca pide el diagnóstico con menos margen del que la extensión necesita para darlo', () => {
    // La extensión sondea Ficha Médico y Gestión de Camas; cada fuente dispone de su
    // propio presupuesto. Rendirse antes convierte una respuesta normal en un falso corte.
    expect(RAYEN_EXTENSION_PASSIVE_HEALTH_TIMEOUT_MS).toBeGreaterThanOrEqual(
      healthProbeTimeoutMs * 2
    );
  });

  it('mantiene el diagnóstico pasivo por debajo del presupuesto de sincronización', () => {
    // Un diagnóstico pasivo no puede bloquear la interfaz tanto como una corrida real.
    expect(RAYEN_EXTENSION_PASSIVE_HEALTH_TIMEOUT_MS).toBeLessThan(
      RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS
    );
  });

  it('concede al arriendo de confianza al menos dos latidos completos', () => {
    // El arriendo declara el corte real. Si cupieran menos de dos latidos, un único
    // latido perdido bastaría para pintar «desconectado» una conexión sana.
    expect(heartbeatPeriodMs).toBeGreaterThan(0);
    expect(RAYEN_EXTENSION_HEALTH_LEASE_MS).toBeGreaterThan(heartbeatPeriodMs * 2);
  });

  it('reintenta varias veces antes de que venza la confianza en el último diagnóstico', () => {
    // La recuperación activa sólo sirve si alcanza a intentarlo dentro de la ventana en
    // la que todavía se conserva el último estado bueno.
    expect(RAYEN_EXTENSION_HEALTH_RECOVERY_BASE_DELAY_MS).toBeGreaterThan(0);
    expect(RAYEN_EXTENSION_HEALTH_RECOVERY_BASE_DELAY_MS).toBeLessThan(
      RAYEN_EXTENSION_HEALTH_RECOVERY_MAX_DELAY_MS
    );
    expect(RAYEN_EXTENSION_HEALTH_RECOVERY_MAX_DELAY_MS).toBeLessThan(
      RAYEN_EXTENSION_HEALTH_LEASE_MS
    );

    let elapsed = 0;
    let attempts = 0;
    while (elapsed < RAYEN_EXTENSION_HEALTH_LEASE_MS) {
      elapsed += Math.min(
        RAYEN_EXTENSION_HEALTH_RECOVERY_MAX_DELAY_MS,
        RAYEN_EXTENSION_HEALTH_RECOVERY_BASE_DELAY_MS * 2 ** attempts
      );
      attempts += 1;
    }
    expect(attempts).toBeGreaterThanOrEqual(3);
  });

  it('deja que el sondeo de una fuente quepa holgadamente en el mensaje a la pestaña', () => {
    const tabMessageTimeoutMs = readNumericConstant(backgroundSource, 'TAB_MESSAGE_TIMEOUT_MS');
    expect(healthProbeTimeoutMs).toBeLessThan(tabMessageTimeoutMs);
  });
});
