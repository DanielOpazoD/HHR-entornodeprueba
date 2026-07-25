// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import '../../../extension/rayen-sync-bundle-runtime.js';

interface SyncBundleRuntime {
  MAX_SOURCE_SKEW_MS: number;
  capture: (input: Record<string, unknown>) => Promise<Record<string, any>>;
}

const runtime = (globalThis as typeof globalThis & { HhrRayenSyncBundleRuntime: SyncBundleRuntime })
  .HhrRayenSyncBundleRuntime;

const readyHealth = {
  fichaMedico: { status: 'ready', message: 'Ficha Médico disponible.' },
  gestionCamas: { status: 'ready', message: 'Gestión de Camas disponible.' },
};

const snapshot = {
  capturedAt: '2026-07-24T10:00:00.000Z',
  facilityId: 1342,
  encounters: [],
  isComplete: true,
};

const report = {
  ok: true,
  rows: [],
  facilityId: 1342,
  capturedAt: '2026-07-24T10:00:20.000Z',
};

const capture = (overrides: Record<string, unknown> = {}) => {
  const times = [new Date('2026-07-24T10:00:00.000Z'), new Date('2026-07-24T10:00:21.000Z')];
  return runtime.capture({
    dateStart: '2026-07-24',
    dateEnd: '2026-07-25',
    readHealth: vi.fn().mockResolvedValue(readyHealth),
    readSnapshot: vi.fn().mockResolvedValue({ snapshot }),
    readReport: vi.fn().mockResolvedValue(report),
    now: () => times.shift() ?? new Date('2026-07-24T10:00:21.000Z'),
    idFactory: () => 'sync-bundle-1',
    ...overrides,
  });
};

describe('Rayen synchronized source bundle', () => {
  it('captures both ready sources and returns one temporal evidence bundle', async () => {
    await expect(capture()).resolves.toMatchObject({
      ok: true,
      snapshot,
      bundle: {
        id: 'sync-bundle-1',
        facilityId: 1342,
        dateStart: '2026-07-24',
        dateEnd: '2026-07-25',
        fichaMedicoCapturedAt: snapshot.capturedAt,
        gestionCamasCapturedAt: report.capturedAt,
        sourceSkewMs: 20_000,
        egresoRows: [],
      },
    });
  });

  it('does not read clinical data unless both tabs are ready', async () => {
    const readSnapshot = vi.fn();
    const readReport = vi.fn();
    const result = await capture({
      readHealth: vi.fn().mockResolvedValue({
        ...readyHealth,
        gestionCamas: { status: 'missing', message: 'Abre Gestión de Camas.' },
      }),
      readSnapshot,
      readReport,
    });

    expect(result).toEqual({ error: 'Abre Gestión de Camas.' });
    expect(readSnapshot).not.toHaveBeenCalled();
    expect(readReport).not.toHaveBeenCalled();
  });

  it('rejects a partial census even when both sessions are connected', async () => {
    await expect(
      capture({
        readSnapshot: vi.fn().mockResolvedValue({
          snapshot: { ...snapshot, isComplete: false },
        }),
      })
    ).resolves.toEqual({
      error: 'Ficha Médico entregó un censo parcial; no se inició la sincronización.',
    });
  });

  it('rejects different facilities and temporally torn reads', async () => {
    await expect(
      capture({
        readReport: vi.fn().mockResolvedValue({ ...report, facilityId: 999 }),
      })
    ).resolves.toEqual({
      error: 'Ficha Médico y Gestión de Camas no corresponden al mismo establecimiento.',
    });

    await expect(
      capture({
        readReport: vi.fn().mockResolvedValue({
          ...report,
          capturedAt: new Date(
            Date.parse(snapshot.capturedAt) + runtime.MAX_SOURCE_SKEW_MS + 1
          ).toISOString(),
        }),
      })
    ).resolves.toEqual({
      error: 'Las fuentes fueron capturadas con demasiado desfase; vuelve a sincronizar.',
    });
  });

  it('rejects a source that disconnects during capture', async () => {
    const readHealth = vi
      .fn()
      .mockResolvedValueOnce(readyHealth)
      .mockResolvedValueOnce({
        ...readyHealth,
        fichaMedico: { status: 'stale', message: 'La sesión de Ficha Médico venció.' },
      });

    await expect(capture({ readHealth })).resolves.toEqual({
      error: 'Una fuente se desconectó durante la captura. La sesión de Ficha Médico venció.',
    });
  });

  it('rejects a capture that crosses the local midnight boundary', async () => {
    const times = [new Date(2026, 6, 24, 23, 59, 59), new Date(2026, 6, 25, 0, 0, 1)];
    await expect(
      capture({ now: () => times.shift() ?? new Date(2026, 6, 25, 0, 0, 1) })
    ).resolves.toEqual({
      error: 'El día cambió durante la captura. Vuelve a sincronizar el censo vigente.',
    });
  });

  it('rejects unavailable egreso evidence and malformed ranges', async () => {
    await expect(
      capture({
        readReport: vi.fn().mockResolvedValue({ error: 'Reporte no disponible.' }),
      })
    ).resolves.toEqual({ error: 'Reporte no disponible.' });

    await expect(capture({ dateStart: '24-07-2026' })).resolves.toEqual({
      error: 'El intervalo solicitado para sincronizar no es válido.',
    });
    await expect(capture({ dateStart: '2026-07-25', dateEnd: '2026-07-24' })).resolves.toEqual({
      error: 'El intervalo solicitado para sincronizar no es válido.',
    });
    await expect(capture({ dateStart: '2026-07-23', dateEnd: '2026-07-24' })).resolves.toEqual({
      error: 'Ficha Médico solo permite sincronizar el censo del día en curso.',
    });
  });
});
