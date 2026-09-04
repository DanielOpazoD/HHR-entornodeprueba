import { describe, expect, it } from 'vitest';
import { deriveRayenRecoveryAction } from '@/features/rayen-import/bridge/rayenRecoveryAction';
import {
  RAYEN_HHR_CONNECTION_REPAIR_BRIDGE_CAPABILITY,
  RAYEN_EXTENSION_PROTOCOL_VERSION,
  type RayenExtensionHealthReport,
} from '@/features/rayen-import/bridge/extensionHealthBridge';

const report = (
  ficha: RayenExtensionHealthReport['fichaMedico'],
  camas: RayenExtensionHealthReport['gestionCamas'],
  capabilities = [RAYEN_HHR_CONNECTION_REPAIR_BRIDGE_CAPABILITY]
): RayenExtensionHealthReport => ({
  version: '0.48.12',
  protocolVersion: RAYEN_EXTENSION_PROTOCOL_VERSION,
  checkedAt: new Date().toISOString(),
  capabilities,
  fichaMedico: ficha,
  gestionCamas: camas,
  hhr: { status: 'ready', reason: 'connected', message: 'HHR vigente.' },
});

const ready = { status: 'ready' as const, reason: 'connected' as const, message: 'Vigente.' };

describe('deriveRayenRecoveryAction', () => {
  it.each([
    ['todo vigente', 'ready', report(ready, ready), 'none', undefined],
    [
      'solo falta Gestión de Camas',
      'blocked',
      report(ready, { status: 'missing', reason: 'tab_missing', message: 'No abierta.' }),
      'connect-gc',
      'Abrir Gestión de Camas',
    ],
    [
      'extensión anterior sin motivo para Gestión de Camas',
      'blocked',
      report(ready, { status: 'missing', message: 'No abierta.' }, []),
      'connect-gc',
      'Abrir Gestión de Camas',
    ],
    [
      'sesión de Camas vencida',
      'blocked',
      report(ready, { status: 'stale', reason: 'session_expired', message: 'Vencida.' }),
      'connect-gc',
      'Iniciar sesión en Gestión de Camas',
    ],
    [
      'sesión de Camas guardada pero no verificada',
      'blocked',
      report(ready, {
        status: 'stale',
        reason: 'session_unverified',
        message: 'Sin verificar.',
        connectionSource: 'session',
      }),
      'connect-gc',
      'Renovar Gestión de Camas',
    ],
    [
      'Ficha pertenece a otra generación',
      'blocked',
      report({ status: 'stale', reason: 'outdated_tab', message: 'Antigua.' }, ready),
      'repair',
      'Abrir conexión limpia',
    ],
    [
      'relé desconectado',
      'blocked',
      report({ status: 'stale', reason: 'relay_disconnected', message: 'Sin relé.' }, ready),
      'repair',
      'Restablecer enlaces',
    ],
  ] as const)(
    '%s produce una única acción contextual',
    (_name, connection, currentReport, kind, label) => {
      expect(
        deriveRayenRecoveryAction({ connection, report: currentReport, working: false })
      ).toMatchObject({ kind, ...(label ? { label } : {}) });
    }
  );

  it('prioriza renovar Ficha Médico antes que una sesión de Camas también próxima a vencer', () => {
    expect(
      deriveRayenRecoveryAction({
        connection: 'blocked',
        working: false,
        report: report({ ...ready, remainingSeconds: 120 }, { ...ready, remainingSeconds: 120 }),
      })
    ).toEqual({ kind: 'repair', label: 'Abrir conexión limpia' });
  });

  it('prioriza Ficha Médico por vencer aunque Gestión de Camas todavía no esté abierta', () => {
    expect(
      deriveRayenRecoveryAction({
        connection: 'blocked',
        working: false,
        report: report(
          { ...ready, remainingSeconds: 120 },
          { status: 'missing', reason: 'tab_missing', message: 'No abierta.' }
        ),
      })
    ).toEqual({ kind: 'repair', label: 'Abrir conexión limpia' });
  });

  it('degrada a comprobación si el runtime existe pero el puente HHR todavía es antiguo', () => {
    expect(
      deriveRayenRecoveryAction({
        connection: 'blocked',
        working: false,
        report: report({ status: 'stale', reason: 'outdated_tab', message: 'Antigua.' }, ready, [
          'clean-connection-repair',
        ]),
      })
    ).toEqual({ kind: 'refresh', label: 'Reintentar comprobación' });
  });
});
