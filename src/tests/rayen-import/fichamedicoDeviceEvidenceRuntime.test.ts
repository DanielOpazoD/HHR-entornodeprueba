// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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

  const backgroundRoute = () => {
    const source = readFileSync('extension/background.js', 'utf8');
    const start = source.indexOf('[RUNTIME_MESSAGES.DEVICE_REPORT_REQUEST]: runtimeRoute(');
    const end = source.indexOf('[RUNTIME_MESSAGES.PATIENT_FLOW_REPORT_REQUEST]', start);
    const runtime = create();
    const context = vm.createContext({
      RUNTIME_MESSAGES: { DEVICE_REPORT_REQUEST: 'device' },
      runtimeRoute: (handle: unknown) => handle,
      handleDeviceReportRequest: runtime.fetchDeviceEvidence,
    });
    return vm.runInContext('({' + source.slice(start, end) + '})', context).device;
  };

  it.each([
    { acceptEntries: true, fecha: '2026-07-28', source: 'json' },
    { acceptEntries: false, fecha: '2026-07-28', source: 'pdf' },
    { acceptEntries: undefined, fecha: '2026-07-28', source: 'pdf' },
    { acceptEntries: 'true', fecha: '2026-07-28', source: 'pdf' },
    { acceptEntries: true, fecha: '2026-07-27', source: 'pdf' },
  ])(
    'negotiates $source through the actual background route with $acceptEntries on $fecha',
    async entry => {
      readJson.mockResolvedValue({ data: [] });
      const result = await backgroundRoute()({
        encId: '141336',
        fecha: entry.fecha,
        acceptEntries: entry.acceptEntries,
      });
      expect(result.source).toBe(entry.source);
      if (entry.source === 'json') {
        expect(result.entries).toEqual([]);
        expect(readJson).toHaveBeenCalledTimes(1);
        expect(fetchDeviceReportBuffer).not.toHaveBeenCalled();
      } else {
        expect(readJson).not.toHaveBeenCalled();
        expect(fetchDeviceReportBuffer).toHaveBeenCalledTimes(1);
      }
    }
  );

  it('keeps the PDF fallback if a negotiated current-day JSON read fails through background', async () => {
    readJson.mockRejectedValue(new Error('synthetic offline'));
    const result = await backgroundRoute()({
      encId: '141336',
      fecha: '2026-07-28',
      acceptEntries: true,
    });
    expect(result).toEqual({ buffer, source: 'pdf' });
    expect(readJson).toHaveBeenCalledTimes(1);
    expect(fetchDeviceReportBuffer).toHaveBeenCalledTimes(1);
  });

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
      create().fetchDeviceEvidence({
        encId: '141336',
        fecha: '2026-07-28',
        info,
        acceptEntries: true,
      })
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

  it('keeps the PDF response for page clients that did not negotiate JSON entries', async () => {
    await expect(
      create().fetchDeviceEvidence({ encId: '141336', fecha: '2026-07-28', info })
    ).resolves.toEqual({ buffer, source: 'pdf' });
    expect(readJson).not.toHaveBeenCalled();
    expect(fetchDeviceReportBuffer).toHaveBeenCalledTimes(1);
  });

  it('uses the PDF when the session role cannot select a role-specific JSON feed', async () => {
    resolveSession.mockResolvedValue({ info: { ...info, role: 'Paramédico' } });

    await expect(
      create().fetchDeviceEvidence({
        encId: '141336',
        fecha: '2026-07-28',
        info,
        acceptEntries: true,
      })
    ).resolves.toEqual({ buffer, source: 'pdf' });
    expect(readJson).not.toHaveBeenCalled();
    expect(fetchDeviceReportBuffer).toHaveBeenCalledTimes(1);
  });

  it('falls back to the daily PDF when the direct endpoint is unavailable', async () => {
    readJson.mockRejectedValue(new Error('HTTP 404'));

    await expect(
      create().fetchDeviceEvidence({
        encId: '141336',
        fecha: '2026-07-28',
        info,
        acceptEntries: true,
      })
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
      create().fetchDeviceEvidence({
        encId: '141336',
        fecha: '2026-07-28',
        info,
        acceptEntries: true,
      })
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
