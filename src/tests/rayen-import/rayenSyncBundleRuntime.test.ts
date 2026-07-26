// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { MAX_HISTORICAL_CENSUS_LOOKBACK_DAYS } from '@/features/rayen-import/domain/historicalCensusSync';

import '../../../extension/clinical-day-runtime.js';
import '../../../extension/census-sync-horizon-runtime.js';
import '../../../extension/rayen-sync-bundle-runtime.js';

interface SyncBundleRuntime {
  MAX_SOURCE_SKEW_MS: number;
  MAX_HISTORICAL_LOOKBACK_DAYS: number;
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
  const times = [new Date('2026-07-24T18:00:00.000Z'), new Date('2026-07-24T18:00:21.000Z')];
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

  it('allows an atomic capture for the immediately previous census day', async () => {
    await expect(
      capture({ dateStart: '2026-07-23', dateEnd: '2026-07-25' })
    ).resolves.toMatchObject({
      ok: true,
      bundle: { dateStart: '2026-07-23', dateEnd: '2026-07-25' },
    });
  });

  it('accepts the seventh prior clinical day and rejects D-8', async () => {
    expect(runtime.MAX_HISTORICAL_LOOKBACK_DAYS).toBe(MAX_HISTORICAL_CENSUS_LOOKBACK_DAYS);
    await expect(
      capture({ dateStart: '2026-07-17', dateEnd: '2026-07-25' })
    ).resolves.toMatchObject({
      ok: true,
      bundle: { dateStart: '2026-07-17', dateEnd: '2026-07-25' },
    });
    await expect(capture({ dateStart: '2026-07-16', dateEnd: '2026-07-25' })).resolves.toEqual({
      error:
        'La reconstrucción automática admite el censo vigente y hasta siete días clínicos anteriores.',
    });
  });

  it('keeps D-1 clinical available before the nursing handoff', async () => {
    // At 04:00 local, the active census is still 23 July and its D-1 is 22 July.
    const times = [new Date('2026-07-24T10:00:00.000Z'), new Date('2026-07-24T10:00:21.000Z')];
    await expect(
      capture({
        dateStart: '2026-07-22',
        dateEnd: '2026-07-25',
        now: () => times.shift() ?? new Date('2026-07-24T10:00:21.000Z'),
      })
    ).resolves.toMatchObject({
      ok: true,
      bundle: { dateStart: '2026-07-22', dateEnd: '2026-07-25' },
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

  it('rejects every capture that crosses local midnight', async () => {
    const times = [new Date('2026-07-25T05:59:59.000Z'), new Date('2026-07-25T06:00:01.000Z')];
    await expect(
      capture({
        dateStart: '2026-07-23',
        dateEnd: '2026-07-25',
        now: () => times.shift() ?? new Date('2026-07-25T06:00:01.000Z'),
      })
    ).resolves.toEqual({
      error:
        'El día cambió durante la captura. Vuelve a sincronizar para conservar una referencia temporal única.',
    });
  });

  it('rejects a capture that crosses the nursing handoff on the same calendar day', async () => {
    // Friday in Rapa Nui: the clinical day changes from Thursday to Friday at 08:00.
    const times = [new Date('2026-07-24T13:59:59.000Z'), new Date('2026-07-24T14:00:01.000Z')];
    await expect(
      capture({
        dateStart: '2026-07-23',
        dateEnd: '2026-07-25',
        now: () => times.shift() ?? new Date('2026-07-24T14:00:01.000Z'),
      })
    ).resolves.toEqual({
      error:
        'El turno de enfermería cambió durante la captura. Vuelve a sincronizar para conservar un único corte temporal.',
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
    await expect(capture({ dateEnd: '2026-07-31' })).resolves.toEqual({
      error: 'El intervalo solicitado para sincronizar no es válido.',
    });
    await expect(capture({ dateStart: '2026-07-16', dateEnd: '2026-07-25' })).resolves.toEqual({
      error:
        'La reconstrucción automática admite el censo vigente y hasta siete días clínicos anteriores.',
    });
  });
});
