// @vitest-environment node
import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseEloisaPatientCode } from '@/features/rayen-manual-import/domain/eloisaPatientCode';
import { mapRayenInvasiveDeviceEntries, mergeReportDevices } from '@/features/rayen-import';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import '../../../extension/eloisa-patient-code-contract.js';

type ExtensionContract = {
  buildPayload: (input: Record<string, unknown>) => Record<string, unknown>;
  createCode: (input: Record<string, unknown>) => Promise<string>;
};

const contract = (
  globalThis as typeof globalThis & {
    HhrEloisaPatientCodeContract: ExtensionContract;
  }
).HhrEloisaPatientCodeContract;

describe('extension/HHR manual patient code compatibility', () => {
  it('creates a code in the extension that HHR reads without losing accents or devices', async () => {
    const payload = contract.buildPayload({
      capturedAt: '2026-08-28T20:15:00.000Z',
      patient: {
        encounterId: '98765',
        firstGivenName: 'José',
        nextGivenNames: 'Ángel',
        firstFamilyName: 'Muñoz',
        secondFamilyName: 'Rapa Nui',
        run: '12.345.678-5',
        birthDate: '1980-05-04',
        gender: 'Masculino',
        admissionDatetime: '2026-08-28T06:35:00-06:00',
        diagnosis: 'Neumonía adquirida en la comunidad',
      },
      deviceEntries: [
        { name: 'VVP', installationDatetime: '2026-08-28T07:15:00-06:00' },
        { name: 'CVC', installationDatetime: '2026-08-27T19:40:00-06:00' },
        { name: 'VVP' },
        { name: 'CUP', removedDatetime: '2026-08-28T08:00:00Z' },
      ],
    });
    const code = await contract.createCode({ payload, cryptoApi: webcrypto });
    const parsed = await parseEloisaPatientCode(code);
    expect(parsed).toMatchObject({
      firstName: 'José',
      middleNames: 'Ángel',
      lastName: 'Muñoz',
      biologicalSex: 'Masculino',
      admissionDate: '2026-08-28',
      admissionTime: '06:35',
      devices: ['VVP', 'CVC'],
      deviceEntries: [
        { name: 'VVP', installationDatetime: '2026-08-28T07:15:00-06:00' },
        { name: 'CVC', installationDatetime: '2026-08-27T19:40:00-06:00' },
        { name: 'VVP' },
      ],
      encounterRoute: 'nurse',
    });

    let nextDeviceId = 0;
    const merged = mergeReportDevices(
      {
        ...createEmptyPatient('R1'),
        patientName: 'Paciente Demo',
        rut: '12.345.678-5',
        clinicalEpisodeId: parsed.encounterId,
      },
      mapRayenInvasiveDeviceEntries(parsed.deviceEntries),
      {
        now: new Date('2026-08-28T20:20:00.000Z'),
        createId: () => `device-${++nextDeviceId}`,
      }
    );
    expect(merged.deviceDetails).toMatchObject({
      'VVP#1': { installationDate: '2026-08-28' },
      CVC: { installationDate: '2026-08-27' },
    });
    expect(merged.deviceInstanceHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'VVP#1',
          installationDate: '2026-08-28',
          installationTime: '07:15',
        }),
        expect.objectContaining({
          type: 'CVC',
          installationDate: '2026-08-27',
          installationTime: '19:40',
        }),
      ])
    );
  });

  it('fails closed when Eloísa omits a mandatory field', () => {
    expect(() =>
      contract.buildPayload({
        capturedAt: '2026-08-28T20:15:00.000Z',
        patient: { encounterId: '9', firstGivenName: 'Ana' },
      })
    ).toThrow(/obligatorios/i);
  });

  it('fails before generating a code when device evidence exceeds the v2 limits', () => {
    const patient = {
      encounterId: '98765',
      firstGivenName: 'Ana',
      firstFamilyName: 'Rapa',
      run: '11.111.111-1',
      admissionDatetime: '2026-08-28T06:35:00-06:00',
    };
    expect(() =>
      contract.buildPayload({
        capturedAt: '2026-08-28T20:15:00.000Z',
        patient,
        deviceEntries: Array.from({ length: 31 }, () => ({ name: 'VVP' })),
      })
    ).toThrow(/más de 30 dispositivos/i);
    expect(() =>
      contract.buildPayload({
        capturedAt: '2026-08-28T20:15:00.000Z',
        patient,
        deviceEntries: [{ name: 'X'.repeat(161) }],
      })
    ).toThrow(/demasiado extenso/i);
  });

  it('rejects an aggregate payload that exceeds the HHR parser limit', async () => {
    const payload = contract.buildPayload({
      capturedAt: '2026-08-28T20:15:00.000Z',
      patient: {
        encounterId: '98765',
        firstGivenName: 'Ana',
        firstFamilyName: 'Rapa',
        run: '11.111.111-1',
        admissionDatetime: '2026-08-28T06:35:00-06:00',
      },
      deviceEntries: Array.from({ length: 30 }, () => ({
        name: 'N'.repeat(160),
        location: 'L'.repeat(160),
        measuredNumber: '1'.repeat(40),
        installationDatetime: 'I'.repeat(80),
        expirationDatetime: 'E'.repeat(80),
      })),
    });

    await expect(contract.createCode({ payload, cryptoApi: webcrypto })).rejects.toThrow(
      /tamaño seguro/i
    );
  });
});
