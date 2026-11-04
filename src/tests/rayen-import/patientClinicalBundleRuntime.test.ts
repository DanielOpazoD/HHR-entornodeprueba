// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import '../../../extension/patient-clinical-bundle-runtime.js';

const runtime = (
  globalThis as typeof globalThis & {
    HhrPatientClinicalBundleRuntime: {
      create: (
        deps: Record<string, unknown>
      ) => (input: Record<string, unknown>) => Promise<unknown>;
    };
  }
).HhrPatientClinicalBundleRuntime;

describe('patient clinical bundle device negotiation', () => {
  it.each([true, false, undefined])('preserves explicit JSON opt-in: %s', async acceptEntries => {
    const readDevices = vi.fn().mockResolvedValue({ entries: [], source: 'json' });
    const readHistory = vi.fn().mockResolvedValue({ events: [] });
    const readForms = vi.fn().mockResolvedValue({ forms: [] });
    const readAlerts = vi.fn().mockResolvedValue({ ok: true, alerts: [] });
    const read = runtime.create({ readDevices, readHistory, readForms, readAlerts });
    await read({ encId: 'synthetic-episode', fecha: '2026-09-05', acceptEntries });
    expect(readDevices).toHaveBeenCalledWith({
      encId: 'synthetic-episode',
      fecha: '2026-09-05',
      acceptEntries: acceptEntries === true,
    });
    expect(readHistory).toHaveBeenCalledTimes(1);
    expect(readForms).toHaveBeenCalledTimes(1);
  });

  it('reads the chart alerts in the same message and isolates their failure', async () => {
    const readAlerts = vi.fn().mockRejectedValue(new Error('alertas caídas'));
    const read = runtime.create({
      readDevices: vi.fn().mockResolvedValue({ entries: [], source: 'json' }),
      readHistory: vi.fn().mockResolvedValue({ events: [] }),
      readForms: vi.fn().mockResolvedValue({ forms: [] }),
      readAlerts,
    });
    const sender = { tab: { id: 7 } };

    await expect(
      read({ encId: 'synthetic-episode', fecha: '2026-09-05', sender })
    ).resolves.toEqual({
      ok: true,
      devices: { entries: [], source: 'json' },
      history: { events: [] },
      forms: { forms: [] },
      alerts: { error: 'alertas caídas' },
    });
    expect(readAlerts).toHaveBeenCalledWith({
      encId: 'synthetic-episode',
      fecha: '2026-09-05',
      sender,
    });
  });
});
