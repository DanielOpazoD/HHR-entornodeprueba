// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/clinical-day-runtime.js';
import '../../../extension/census-sync-horizon-runtime.js';
import '../../../extension/capture-read-recovery.js';
import '../../../extension/rayen-sync-bundle-runtime.js';
import '../../../extension/fichamedico-read-resilience.js';

type Health = Record<string, { status: string; message: string }>;

const globals = globalThis as typeof globalThis & {
  HhrRayenSyncBundleRuntime: {
    capture: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  HhrFichaMedicoReadResilience: {
    describeSessionStatus: (input: Record<string, unknown>) => { ready: boolean; message: string };
  };
};

const ready: Health = {
  fichaMedico: { status: 'ready', message: 'Ficha Médico disponible.' },
  gestionCamas: { status: 'ready', message: 'Gestión de Camas disponible.' },
};

// The exact health a signed-in Ficha Médico tab reports during its read block.
const readBlocked: Health = {
  ...ready,
  fichaMedico: {
    status: 'stale',
    message: globals.HhrFichaMedicoReadResilience.describeSessionStatus({
      sessionReady: true,
      readBlocked: true,
    }).message,
  },
};

const snapshot = {
  snapshot: {
    capturedAt: '2026-07-24T10:00:00.000Z',
    facilityId: 1342,
    encounters: [],
    isComplete: true,
  },
};

const capture = (
  healths: Health[],
  readSnapshot: () => Promise<unknown>,
  extra: Record<string, unknown> = {}
) => {
  const times = [new Date('2026-07-24T18:00:00.000Z'), new Date('2026-07-24T18:00:21.000Z')];
  const readHealth = vi.fn();
  healths.forEach(health => readHealth.mockResolvedValueOnce(health));
  return globals.HhrRayenSyncBundleRuntime.capture({
    dateStart: '2026-07-24',
    dateEnd: '2026-07-25',
    readHealth,
    readFichaScope: vi.fn().mockResolvedValue('1342:3:5'),
    readSnapshot,
    readReport: vi.fn().mockResolvedValue({
      ok: true,
      rows: [],
      facilityId: 1342,
      capturedAt: '2026-07-24T10:00:20.000Z',
    }),
    now: () => times.shift() ?? new Date('2026-07-24T18:00:21.000Z'),
    idFactory: () => 'sync-bundle-read-block',
    ...extra,
  });
};

describe('Rayen capture while Ficha Médico is in its read block', () => {
  afterEach(() => vi.useRealTimers());

  it('reads anyway; once the network is back the read clears the block and the sync completes', async () => {
    const readSnapshot = vi.fn().mockResolvedValue(snapshot);

    const result = await capture([readBlocked, ready], readSnapshot);

    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        bundle: expect.objectContaining({ id: 'sync-bundle-read-block' }),
      })
    );
  });

  it('retries once after a brief pause when attempt 1 leaves Ficha Médico read-blocked and recovers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce({
        error:
          'No se pudo leer Rayen. Detalle: Failed to fetch al consultar https://example.invalid/census',
      })
      .mockResolvedValueOnce(snapshot);

    const pending = capture([ready, readBlocked, ready], readSnapshot);
    await vi.advanceTimersByTimeAsync(1199);
    expect(readSnapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(readSnapshot).toHaveBeenCalledTimes(2);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        bundle: expect.objectContaining({ id: 'sync-bundle-read-block', captureRetries: 1 }),
      })
    );
  });

  it('retries once while read-blocked and preserves the real endpoint failure when the network stays down', async () => {
    const networkError =
      'No se pudo leer Rayen. Detalle: Failed to fetch al consultar https://example.invalid/census';
    const readSnapshot = vi.fn().mockResolvedValue({ error: networkError });

    const result = await capture([readBlocked, readBlocked], readSnapshot, { retryDelayMs: 0 });

    expect(readSnapshot).toHaveBeenCalledTimes(2);
    expect(result.ok).toBeUndefined();
    expect(result.error).toBe(networkError);
    expect(result.captureRetries).toBe(1);
  });

  it('does not read when Ficha Médico is unavailable for any other reason', async () => {
    const readSnapshot = vi.fn().mockResolvedValue(snapshot);

    const result = await capture(
      [
        {
          ...ready,
          fichaMedico: { status: 'stale', message: 'La sesión de Ficha Médico venció.' },
        },
      ],
      readSnapshot
    );

    expect(readSnapshot).not.toHaveBeenCalled();
    expect(result).toEqual({ error: 'La sesión de Ficha Médico venció.' });
  });

  it('does not read when Gestión de Camas is also unavailable', async () => {
    const readSnapshot = vi.fn().mockResolvedValue(snapshot);

    const result = await capture(
      [{ ...readBlocked, gestionCamas: { status: 'missing', message: 'Abre Gestión de Camas.' } }],
      readSnapshot
    );

    expect(readSnapshot).not.toHaveBeenCalled();
    expect(result).toEqual({ error: readBlocked.fichaMedico.message });
  });
});
