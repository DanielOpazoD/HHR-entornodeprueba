import { describe, expect, it } from 'vitest';
import { documentIdentityKey } from '@/utils/rutUtils';
import {
  buildAdminHarness,
  createListUploadPatientOptionsHandler,
  resolveUploadPatientOptionForExactDate,
  seedPin,
} from './prescriptionAccessFunctions.testSupport';

const date = '2026-05-04';
const changedPatient = {
  code: 'failed-precondition',
  message: 'El paciente asociado a la cama cambió. Actualiza el selector antes de subir.',
};
const setup = (left: string, right?: string) => {
  const harness = buildAdminHarness({
    dailyRecords: {
      [date]: {
        beds: {
          B1: { patientName: 'Persona sintética A', rut: left },
          ...(right === undefined
            ? {}
            : { B2: { patientName: 'Persona sintética B', rut: right } }),
        },
      },
    },
  });
  const list = createListUploadPatientOptionsHandler({
    firestore: harness.admin.firestore(),
    resolveRoleForEmail: async () => 'nurse_hospital',
  });
  return {
    ...harness,
    list: () => list({ date }, { auth: { token: { email: 'synthetic@example.test' } } }),
    listPin: () => list({ date, pin: '7351' }, undefined),
    guard: (expected: string) =>
      resolveUploadPatientOptionForExactDate(harness.admin.firestore(), date, date, 'B1', expected),
  };
};

describe('server prescription document identity', () => {
  it.each(['authenticated', 'QR + PIN'])('keeps passport and RUT options via %s', async mode => {
    const harness = setup('12.345.678-5', 'P123456785');
    await seedPin(harness.accessConfig, '7351');
    const result = await (mode === 'authenticated' ? harness.list() : harness.listPin());
    expect(result.patientOptions.map((option: { key: string }) => option.key)).toEqual([
      'B1',
      'B2',
    ]);
  });

  it('rejects a passport selected against an expected RUT with the same digits', async () => {
    await expect(setup('P123456785').guard('12.345.678-5')).rejects.toMatchObject(changedPatient);
  });

  it.each([
    ['12.345.678-5', '123456785', true],
    ['12.345.678-K', '12345678k', true],
    ['12345678k', '12.345.678-K', true],
    ['12.345.678-5', '12.345.678-6', false],
    ['12.345.678-K', '12.345.678-5', false],
    ['', '', false],
    ['', '123456785', false],
    ['123456785', '', false],
  ])('preserves main RUT behavior: %s / %s', async (left, right, accepted) => {
    const harness = setup(left, right);
    const result = await harness.list();
    expect(result.patientOptions).toEqual([
      {
        key: 'B1',
        bedId: 'B1',
        patientName: 'Persona sintética A',
        patientRut: left,
        patientStatus: 'active',
      },
      ...(accepted
        ? []
        : [
            {
              key: 'B2',
              bedId: 'B2',
              patientName: 'Persona sintética B',
              patientRut: right,
              patientStatus: 'active',
            },
          ]),
    ]);
    if (accepted)
      await expect(harness.guard(right)).resolves.toMatchObject({
        patient: { key: 'B1', patientRut: left },
      });
    else await expect(harness.guard(right)).rejects.toMatchObject(changedPatient);
  });

  it('matches the app key equivalence through picker and guard for the entire corpus', async () => {
    const corpus = [
      '12.345.678-5',
      '123456785',
      '12.345.678-K',
      '12345678k',
      '12345678K.',
      'K123456785',
      'k12.345.678-5',
      'P123456785',
      'p12.345.678-5',
      'Q123456785',
      'Ñ123',
      'ñ-1.23',
      'SIN RUT',
      'S/N',
      'RN',
      'K',
      '',
      '---',
    ];
    for (const left of corpus) {
      for (const right of corpus) {
        const leftKey = documentIdentityKey(left);
        const rightKey = documentIdentityKey(right);
        const sameDocument = Boolean(leftKey && rightKey && leftKey === rightKey);
        const harness = setup(left, right);
        const result = await harness.list();
        expect(result.patientOptions, `${left} / ${right}`).toHaveLength(sameDocument ? 1 : 2);
        if (sameDocument)
          await expect(harness.guard(right)).resolves.toMatchObject({ patient: { key: 'B1' } });
        else await expect(harness.guard(right)).rejects.toMatchObject(changedPatient);
      }
    }
  });
});
