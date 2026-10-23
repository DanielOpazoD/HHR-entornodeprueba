import { expect, vi } from 'vitest';
import type { RayenExtensionHealthState } from '@/features/rayen-import/hooks/useRayenExtensionHealth';
import {
  RAYEN_EXTENSION_PROTOCOL_VERSION,
  RAYEN_HEALTH_PUSH_CAPABILITY,
  type RayenExtensionHealthReport,
} from '@/features/rayen-import/bridge/extensionHealthBridge';

const mocks = vi.hoisted(() => ({
  requestHealth: vi.fn(),
}));

vi.mock('@/features/rayen-import/bridge/extensionHealthBridge', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/features/rayen-import/bridge/extensionHealthBridge')>();
  return { ...actual, requestRayenExtensionHealth: mocks.requestHealth };
});

export const makeReport = (
  overrides: Partial<RayenExtensionHealthReport> = {}
): RayenExtensionHealthReport => ({
  version: '0.6.0',
  protocolVersion: RAYEN_EXTENSION_PROTOCOL_VERSION,
  syncPreflight: true,
  capabilities: [RAYEN_HEALTH_PUSH_CAPABILITY, 'sync-preflight-verification'],
  checkedAt: new Date().toISOString(),
  fichaMedico: { status: 'ready', message: 'Ficha Médico disponible.' },
  gestionCamas: { status: 'ready', message: 'Gestión de Camas disponible.' },
  ...overrides,
});

export const expectConnection = (
  state: RayenExtensionHealthState,
  connection: RayenExtensionHealthState['connection'],
  canSync: boolean
): void => {
  expect(state.connection).toBe(connection);
  expect(state.canSync).toBe(canSync);
};

export { mocks };
