// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import '../../../extension/fichamedico-manual-patient-code-runtime.js';

type RuntimeFactory = {
  create: (
    dependencies: Record<string, unknown>
  ) => (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

const factory = (
  globalThis as typeof globalThis & {
    HhrFichaMedicoManualPatientCodeRuntime: RuntimeFactory;
  }
).HhrFichaMedicoManualPatientCodeRuntime;

describe('manual patient code background runtime', () => {
  it('revalidates the active episode and uses authenticated readers without writing Eloísa', async () => {
    const createCode = vi.fn().mockResolvedValue('HHR-PACIENTE-1.payload.checksum');
    const runtime = factory.create({
      resolveSession: vi.fn().mockResolvedValue({ info: { authenticated: true } }),
      fetchActiveEncounterRows: vi.fn().mockResolvedValue({ rows: [{ id: 91 }] }),
      fetchPatientHeader: vi.fn().mockResolvedValue({ firstGivenName: 'Ana' }),
      fetchDeviceEvidence: vi.fn().mockResolvedValue({ entries: [{ name: 'VVP' }] }),
      normalizePatient: vi.fn().mockReturnValue({ encounterId: '91', firstGivenName: 'Ana' }),
      clinicalDayAt: vi.fn().mockReturnValue('2026-08-28'),
      codeContract: {
        buildPayload: vi.fn().mockReturnValue({ version: 1, encounterId: '91' }),
        createCode,
      },
      cryptoApi: {},
      now: () => Date.parse('2026-08-28T20:15:00.000Z'),
    });

    await expect(runtime({ encId: '91', sender: { tab: { id: 3 } } })).resolves.toEqual({
      ok: true,
      code: 'HHR-PACIENTE-1.payload.checksum',
      formatVersion: 1,
    });
    expect(createCode).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the selected encounter is no longer active', async () => {
    const fetchPatientHeader = vi.fn();
    const runtime = factory.create({
      resolveSession: vi.fn().mockResolvedValue({ info: {} }),
      fetchActiveEncounterRows: vi.fn().mockResolvedValue({ rows: [{ id: 92 }] }),
      fetchPatientHeader,
      fetchDeviceEvidence: vi.fn(),
      normalizePatient: vi.fn(),
      clinicalDayAt: vi.fn(),
      codeContract: {},
      cryptoApi: {},
      now: Date.now,
    });

    await expect(runtime({ encId: '91' })).resolves.toMatchObject({
      error: expect.stringMatching(/ya no figura/i),
    });
    expect(fetchPatientHeader).not.toHaveBeenCalled();
  });
});
