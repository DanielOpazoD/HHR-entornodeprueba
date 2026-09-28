// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildEloisaAdmissionInput } from '@/application/census/eloisaAdmissionInput';
import type { EloisaManualPatientPayload } from '@/features/rayen-manual-import';

const payload: EloisaManualPatientPayload = {
  version: 2,
  capturedAt: '2026-09-27T12:00:00.000Z',
  encounterId: 'synthetic-episode',
  firstName: 'Paciente',
  middleNames: 'de Prueba',
  lastName: 'Sintético',
  secondLastName: 'Local',
  rut: '12.345.678-5',
  birthDate: '1980-05-04',
  biologicalSex: 'Masculino',
  admissionDate: '2026-09-27',
  admissionTime: '06:35',
  diagnosis: 'Diagnóstico sintético',
  devices: ['VVP'],
  deviceEntries: [],
  encounterRoute: 'nurse',
};
const runtime = {
  now: new Date('2026-09-27T12:30:00.000Z'),
  createId: () => 'synthetic-device-id',
};

describe('Eloisa admission input mapping', () => {
  it('preserves identity, episode provenance and legacy devices without mutating the payload', () => {
    const before = structuredClone(payload);
    const result = buildEloisaAdmissionInput(payload, 'R2', runtime);
    expect(result).toMatchObject({
      bedId: 'R2',
      firstName: 'Paciente de Prueba',
      lastName: 'Sintético',
      secondLastName: 'Local',
      rut: payload.rut,
      birthDate: payload.birthDate,
      biologicalSex: 'Masculino',
      admissionDate: payload.admissionDate,
      admissionTime: '06:35',
      pathology: payload.diagnosis,
      devices: ['VVP'],
      clinicalEpisodeId: payload.encounterId,
      eloisaManualAdmissionSource: {
        method: 'eloisa_manual_code',
        capturedAt: payload.capturedAt,
        formatVersion: 2,
        encounterId: payload.encounterId,
        encounterRoute: 'nurse',
      },
    });
    expect(result.patientName).toContain('Paciente');
    expect(payload).toEqual(before);
    expect(buildEloisaAdmissionInput(payload, 'R2', runtime)).toEqual(result);
  });

  it('uses structured device evidence and injected ids instead of ambient time or randomness', () => {
    const withDevices = {
      ...payload,
      devices: ['CVC'],
      deviceEntries: [
        { name: 'Sonda Nasogástrica', installationDatetime: '2026-09-27T08:15:00-06:00' },
      ],
    };
    const before = structuredClone(withDevices);
    const result = buildEloisaAdmissionInput(withDevices, 'R1', runtime);
    expect(result.devices).toEqual(['SNG']);
    expect(result.deviceInstanceHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'synthetic-device-id' })])
    );
    expect(withDevices).toEqual(before);
    expect(buildEloisaAdmissionInput(withDevices, 'R1', runtime)).toEqual(result);
  });
});
