import { describe, expect, it } from 'vitest';
import {
  deriveHealthState,
  type RayenExtensionHealthState,
} from '@/features/rayen-import/hooks/useRayenExtensionHealth';
import {
  RAYEN_EXTENSION_PROTOCOL_VERSION,
  type RayenExtensionHealthReport,
} from '@/features/rayen-import/bridge/extensionHealthBridge';

const makeReport = (
  overrides: Partial<RayenExtensionHealthReport> = {}
): RayenExtensionHealthReport => ({
  version: '0.6.0',
  protocolVersion: RAYEN_EXTENSION_PROTOCOL_VERSION,
  checkedAt: '2026-07-14T05:00:00.000Z',
  fichaMedico: { status: 'ready', message: 'Ficha Médico disponible.' },
  gestionCamas: { status: 'ready', message: 'Gestión de Camas disponible.' },
  ...overrides,
});

const expectConnection = (
  state: RayenExtensionHealthState,
  connection: RayenExtensionHealthState['connection'],
  canSync: boolean
): void => {
  expect(state.connection).toBe(connection);
  expect(state.canSync).toBe(canSync);
};

describe('deriveHealthState', () => {
  it('requires both Rayen sources before allowing synchronization', () => {
    expectConnection(deriveHealthState(makeReport()), 'ready', true);
    expectConnection(
      deriveHealthState(
        makeReport({
          gestionCamas: { status: 'missing', message: 'Gestión de Camas no está abierta.' },
        })
      ),
      'blocked',
      false
    );
    expectConnection(
      deriveHealthState(
        makeReport({
          fichaMedico: { status: 'stale', message: 'Recarga Ficha Médico.' },
        })
      ),
      'blocked',
      false
    );
    expectConnection(deriveHealthState(makeReport({ protocolVersion: 1 })), 'incompatible', false);
    expectConnection(deriveHealthState(null, 'Sin extensión.'), 'offline', false);
  });
});
