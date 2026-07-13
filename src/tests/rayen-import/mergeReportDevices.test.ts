import { describe, expect, it } from 'vitest';
import { mergeReportDevices, type MappedDevice } from '@/features/rayen-import';
import type { PatientData } from '@/types/domain/patient';
import type { DeviceInstance } from '@/types/domain/devices';

const patient = (over: Partial<PatientData> = {}): PatientData =>
  ({
    patientName: 'Ana Perez',
    rut: '1-9',
    clinicalEpisodeId: 'E1',
    devices: [],
    deviceDetails: {},
    deviceInstanceHistory: [],
    ...over,
  }) as unknown as PatientData;

const cup: MappedDevice = {
  type: 'CUP',
  installationDate: '2026-06-29',
  installationTime: '10:32',
  location: 'Zona genital',
  note: 'Vence: 9/08/26 0:00',
};

const ctx = { now: new Date(2026, 6, 10, 12, 0, 0), createId: () => 'id-1' };

describe('mergeReportDevices', () => {
  it('adds a new Active device with column type, details and full instance data', () => {
    const result = mergeReportDevices(patient(), [cup], ctx);
    expect(result.devices).toEqual(['CUP']);
    expect(result.deviceDetails?.CUP).toMatchObject({
      installationDate: '2026-06-29',
      note: 'Zona genital · Vence: 9/08/26 0:00',
    });
    expect(result.deviceInstanceHistory).toHaveLength(1);
    expect(result.deviceInstanceHistory?.[0]).toMatchObject({
      type: 'CUP',
      status: 'Active',
      installationDate: '2026-06-29',
      installationTime: '10:32',
      location: 'Zona genital',
      clinicalEpisodeId: 'E1',
      patientRut: '1-9',
    });
  });

  it('refreshes an already-Active device in place, without duplicating it', () => {
    const existingInstance: DeviceInstance = {
      id: 'old',
      type: 'CUP',
      status: 'Active',
      installationDate: '2026-06-01',
      installationTime: '',
      location: '',
      createdAt: 1,
      updatedAt: 1,
    };
    const before = patient({ devices: ['CUP'], deviceInstanceHistory: [existingInstance] });
    const result = mergeReportDevices(before, [cup], ctx);
    expect(result.deviceInstanceHistory).toHaveLength(1);
    expect(result.deviceInstanceHistory?.[0]).toMatchObject({
      id: 'old', // same instance, updated in place
      installationDate: '2026-06-29',
      location: 'Zona genital',
    });
    expect(result.devices).toEqual(['CUP']);
  });

  it('returns the patient unchanged when there are no devices', () => {
    const before = patient();
    expect(mergeReportDevices(before, [], ctx)).toBe(before);
  });

  it('keeps an HHR-managed device that Eloísa does NOT report (e.g. a manual CVC)', () => {
    // Nurse configured a CVC in HHR; it's absent from Eloísa's report, which only carries a CUP.
    const cvcInstance: DeviceInstance = {
      id: 'cvc-1',
      type: 'CVC',
      status: 'Active',
      installationDate: '2026-07-01',
      installationTime: '09:00',
      location: 'Yugular derecha',
      createdAt: 1,
      updatedAt: 1,
    };
    const before = patient({
      devices: ['CVC'],
      deviceDetails: { CVC: { installationDate: '2026-07-01' } },
      deviceInstanceHistory: [cvcInstance],
    });
    const result = mergeReportDevices(before, [cup], ctx);
    // The manual CVC survives; the Eloísa CUP is added alongside it.
    expect(result.devices).toEqual(['CVC', 'CUP']);
    expect(result.deviceDetails?.CVC).toMatchObject({ installationDate: '2026-07-01' });
    expect(result.deviceInstanceHistory?.find(d => d.type === 'CVC')).toMatchObject({
      id: 'cvc-1',
    });
    expect(result.deviceInstanceHistory?.some(d => d.type === 'CUP')).toBe(true);
  });

  it('never drops HHR-managed devices even when Eloísa reports an empty device list', () => {
    const before = patient({ devices: ['CVC', 'SNG'] });
    // Empty Eloísa report → no-op, so nothing the nurse manages is touched.
    expect(mergeReportDevices(before, [], ctx)).toBe(before);
  });
});
