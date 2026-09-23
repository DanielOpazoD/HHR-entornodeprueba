// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import '../../../extension/connection-relay-recovery.js';
import '../../../extension/health-check.js';
import '../../../extension/gestion-camas-health.js';

const health = (
  globalThis as typeof globalThis & {
    HhrGestionCamasHealth: {
      create: (
        deps: Record<string, unknown>
      ) => (generation: string) => Promise<Record<string, unknown>>;
    };
    HhrExtensionHealth: Record<string, unknown>;
  }
).HhrGestionCamasHealth;

const createCheck = (sendMessage: ReturnType<typeof vi.fn>) => {
  const recoverMissingReceiver = vi.fn(async () => ({ injected: true }));
  const readSession = vi.fn(async () => ({ sourceTabId: 7 }));
  const check = health.create({
    chromeApi: {
      tabs: {
        query: vi.fn(async () => [{ id: 7, url: 'https://hospitalizado.rayensalud.cl/#/bed' }]),
        sendMessage,
      },
    },
    extensionHealth: (
      globalThis as typeof globalThis & { HhrExtensionHealth: Record<string, unknown> }
    ).HhrExtensionHealth,
    session: {
      isUsable: () => true,
      isVerificationFresh: () => true,
      publicStatus: () => ({ status: 'ready', message: 'Sesión vigente.' }),
    },
    withTimeout: (promise: Promise<unknown>) => promise,
    healthProbeTimeoutMs: 5_000,
    recoverMissingReceiver,
    matchPattern: 'https://hospitalizado.rayensalud.cl/*',
    readSession,
    clearUnusableSession: vi.fn(),
    requestLiveSession: vi.fn(),
    verifySession: vi.fn(),
  });
  return { check, recoverMissingReceiver, readSession };
};

describe('Gestión de Camas health relay recovery', () => {
  it('reinjects a missing receiver in an already open tab and rechecks before reporting ready', async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(
        new Error('Could not establish connection. Receiving end does not exist.')
      )
      .mockResolvedValueOnce({ ready: true, message: 'Gestión de Camas disponible.' });
    const { check, recoverMissingReceiver, readSession } = createCheck(sendMessage);

    await expect(check('generation')).resolves.toMatchObject({ status: 'ready' });
    expect(recoverMissingReceiver).toHaveBeenCalledExactlyOnceWith(7);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(readSession).toHaveBeenCalledOnce();
  });

  it('repairs a silent missing health listener without touching an authenticated session', async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ready: true, message: 'Gestión de Camas disponible.' });
    const { check, recoverMissingReceiver, readSession } = createCheck(sendMessage);

    await expect(check('generation')).resolves.toMatchObject({ status: 'ready' });
    expect(recoverMissingReceiver).toHaveBeenCalledExactlyOnceWith(7);
    expect(readSession).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
