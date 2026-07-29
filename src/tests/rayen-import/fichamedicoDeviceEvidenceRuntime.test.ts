// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/fichamedico-device-evidence-runtime.js';

type DeviceRuntimeFactory = {
  create: (dependencies: Record<string, unknown>) => {
    fetchDeviceEvidence: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
};

const factory = (
  globalThis as typeof globalThis & {
    HhrFichaMedicoDeviceEvidenceRuntime: DeviceRuntimeFactory;
  }
).HhrFichaMedicoDeviceEvidenceRuntime;

describe('Ficha Médico device evidence runtime', () => {
  const info = { role: 'Médico', practitionerId: '81' };
  const buffer = Uint8Array.from([0x25, 0x50, 0x44, 0x46]).buffer;
  let resolveSession: ReturnType<typeof vi.fn>;
  let readJson: ReturnType<typeof vi.fn>;
  let fetchDeviceReportBuffer: ReturnType<typeof vi.fn>;
  let clinicalDayAt: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resolveSession = vi.fn().mockResolvedValue({ info });
    readJson = vi.fn();
    fetchDeviceReportBuffer = vi.fn().mockResolvedValue({ buffer });
    clinicalDayAt = vi.fn().mockReturnValue('2026-07-28');
  });

  const create = () =>
    factory.create({ resolveSession, readJson, fetchDeviceReportBuffer, clinicalDayAt });

  it('prefers the direct JSON projection without leaking extra patient fields', async () => {
    readJson.mockResolvedValue({
      data: [
        {
          name: 'Vía venosa periférica',
          location: 'Brazo derecho',
          measuredNumber: 20,
          installationDatetime: '2026-07-28T09:30:00-06:00',
          expirationDatetime: '2026-08-01T09:30:00-06:00',
          removedDatetime: null,
          archived: false,
          deleted: false,
          patientName: 'no debe salir del adaptador',
        },
      ],
    });

    await expect(
      create().fetchDeviceEvidence({ encId: '141336', fecha: '2026-07-28', info })
    ).resolves.toEqual({
      source: 'json',
      entries: [
        {
          name: 'Vía venosa periférica',
          location: 'Brazo derecho',
          measuredNumber: 20,
          installationDatetime: '2026-07-28T09:30:00-06:00',
          expirationDatetime: '2026-08-01T09:30:00-06:00',
          removedDatetime: null,
          archived: false,
          deleted: false,
        },
      ],
    });
    expect(readJson).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/encounter/entrySummary/invasiveDeviceEntry/141336/1/81',
      })
    );
    expect(fetchDeviceReportBuffer).not.toHaveBeenCalled();
  });

  it('falls back to the daily PDF when the direct endpoint is unavailable', async () => {
    readJson.mockRejectedValue(new Error('HTTP 404'));

    await expect(
      create().fetchDeviceEvidence({ encId: '141336', fecha: '2026-07-28', info })
    ).resolves.toEqual({ buffer, source: 'pdf' });
    expect(fetchDeviceReportBuffer).toHaveBeenCalledWith({
      encId: '141336',
      fecha: '2026-07-28',
      info,
    });
  });

  it('falls back to the daily PDF when the direct endpoint returns a malformed envelope', async () => {
    readJson.mockResolvedValue({ data: { items: [] } });

    await expect(
      create().fetchDeviceEvidence({ encId: '141336', fecha: '2026-07-28', info })
    ).resolves.toEqual({ buffer, source: 'pdf' });
    expect(fetchDeviceReportBuffer).toHaveBeenCalledWith({
      encId: '141336',
      fecha: '2026-07-28',
      info,
    });
  });

  it('uses the date-aware PDF directly for a historical census', async () => {
    clinicalDayAt.mockReturnValue('2026-07-29');

    await expect(
      create().fetchDeviceEvidence({ encId: '141336', fecha: '2026-07-28', info })
    ).resolves.toEqual({ buffer, source: 'pdf' });
    expect(readJson).not.toHaveBeenCalled();
    expect(fetchDeviceReportBuffer).toHaveBeenCalledTimes(1);
  });
});
