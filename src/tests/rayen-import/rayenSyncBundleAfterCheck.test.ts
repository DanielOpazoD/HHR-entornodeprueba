// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import '../../../extension/clinical-day-runtime.js';
import '../../../extension/census-sync-horizon-runtime.js';
import '../../../extension/capture-read-recovery.js';
import '../../../extension/rayen-sync-bundle-runtime.js';

const runtime = (
  globalThis as typeof globalThis & {
    HhrRayenSyncBundleRuntime: {
      capture: (input: Record<string, unknown>) => Promise<Record<string, any>>;
    };
  }
).HhrRayenSyncBundleRuntime;

const ready = {
  fichaMedico: { status: 'ready', message: 'Ficha Médico disponible.' },
  gestionCamas: { status: 'ready', message: 'Gestión de Camas disponible.' },
};

const captureWithHealthAfter = (after: Record<string, unknown>) => {
  const times = [new Date('2026-07-24T18:00:00.000Z'), new Date('2026-07-24T18:00:21.000Z')];
  return runtime.capture({
    dateStart: '2026-07-24',
    dateEnd: '2026-07-25',
    readHealth: vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce(after),
    readSnapshot: vi.fn().mockResolvedValue({
      snapshot: {
        capturedAt: '2026-07-24T10:00:00.000Z',
        facilityId: 1342,
        encounters: [],
        isComplete: true,
      },
    }),
    readReport: vi.fn().mockResolvedValue({
      ok: true,
      rows: [],
      facilityId: 1342,
      capturedAt: '2026-07-24T10:00:20.000Z',
    }),
    now: () => times.shift() ?? new Date('2026-07-24T18:00:21.000Z'),
    idFactory: () => 'sync-bundle-after',
  });
};

describe('Rayen capture after both sources were read', () => {
  it('keeps the capture when the sleeping Gestión de Camas tab no longer answers: its report is already in', async () => {
    const result = await captureWithHealthAfter({
      ...ready,
      gestionCamas: {
        status: 'stale',
        message: 'La pestaña de Gestión de Camas no respondió a la comprobación.',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        bundle: expect.objectContaining({ id: 'sync-bundle-after' }),
      })
    );
  });

  it('still rejects the capture when Ficha Médico disconnected, since its tab did the reading', async () => {
    await expect(
      captureWithHealthAfter({
        ...ready,
        fichaMedico: { status: 'stale', message: 'La sesión de Ficha Médico venció.' },
      })
    ).resolves.toEqual({
      error: 'Una fuente se desconectó durante la captura. La sesión de Ficha Médico venció.',
    });
  });
});
