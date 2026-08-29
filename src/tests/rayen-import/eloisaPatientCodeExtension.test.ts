// @vitest-environment node
import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseEloisaPatientCode } from '@/features/rayen-manual-import/domain/eloisaPatientCode';
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
        { name: 'VVP' },
        { name: 'CVC' },
        { name: 'VVP' },
        { name: 'CUP', removedDatetime: '2026-08-28T08:00:00Z' },
      ],
    });
    const code = await contract.createCode({ payload, cryptoApi: webcrypto });
    expect(await parseEloisaPatientCode(code)).toMatchObject({
      firstName: 'José',
      middleNames: 'Ángel',
      lastName: 'Muñoz',
      admissionDate: '2026-08-28',
      admissionTime: '06:35',
      devices: ['VVP', 'CVC'],
    });
  });

  it('fails closed when Eloísa omits a mandatory field', () => {
    expect(() =>
      contract.buildPayload({
        capturedAt: '2026-08-28T20:15:00.000Z',
        patient: { encounterId: '9', firstGivenName: 'Ana' },
      })
    ).toThrow(/obligatorios/i);
  });
});
