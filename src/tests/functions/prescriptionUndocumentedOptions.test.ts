import { describe, expect, it } from 'vitest';
import {
  buildAdminHarness,
  createListUploadPatientOptionsHandler,
  seedPin,
} from './prescriptionAccessFunctions.testSupport';
const date = '2026-05-04';
const options = async (rut: string, name: string, active: boolean, pin: boolean) => {
  const harness = buildAdminHarness({
    dailyRecords: {
      [date]: {
        beds: active ? { R1: { patientName: 'Ana Inventada', rut } } : {},
        discharges: [{ id: 'synthetic-discharge', bedId: 'R1', patientName: name, rut }],
        transfers: [{ id: 'synthetic-transfer', bedId: 'R1', patientName: name, rut }],
      },
    },
  });
  const handler = createListUploadPatientOptionsHandler({
    firestore: harness.admin.firestore(),
    resolveRoleForEmail: async () => 'nurse_hospital',
  });
  if (pin) await seedPin(harness.accessConfig, '7351');
  return (
    await handler(
      pin ? { date, pin: '7351' } : { date },
      pin ? undefined : { auth: { token: { email: 'synthetic@example.test' } } }
    )
  ).patientOptions;
};
describe('server undocumented people sharing a bed', () => {
  it.each(['', 'SIN RUT', 'RN', 'S/N'])(
    'keeps both people with stable movement keys: %s',
    async rut => {
      for (const pin of [false, true]) {
        expect(await options(rut, 'Bea Inventada', true, pin)).toEqual([
          {
            key: 'R1',
            bedId: 'R1',
            patientName: 'Ana Inventada',
            patientRut: rut,
            patientStatus: 'active',
          },
          {
            key: 'discharge:synthetic-discharge',
            bedId: 'R1',
            patientName: 'Bea Inventada',
            patientRut: rut,
            patientStatus: 'discharge',
          },
        ]);
      }
    }
  );
  it.each(['', 'SIN RUT', 'RN', '12.345.678-5', 'P123456785'])(
    'preserves keys and first state for one person: %s',
    async rut => {
      expect(await options(rut, '  ANA   INVENTÁDA  ', true, false)).toEqual([
        {
          key: 'R1',
          bedId: 'R1',
          patientName: 'Ana Inventada',
          patientRut: rut,
          patientStatus: 'active',
        },
      ]);
      expect(await options(rut, 'Ana Inventada', false, false)).toEqual([
        {
          key: 'discharge:synthetic-discharge',
          bedId: 'R1',
          patientName: 'Ana Inventada',
          patientRut: rut,
          patientStatus: 'discharge',
        },
      ]);
    }
  );
});

it.each(['', 'RN', 'SIN RUT'])(
  'gives distinct keys to different movements without ids: %s',
  async rut => {
    const harness = buildAdminHarness({
      dailyRecords: {
        [date]: {
          beds: {},
          discharges: [
            { bedId: 'R1', patientName: 'Ana Inventada', rut },
            { bedId: 'R1', patientName: 'Bea Inventada', rut },
            { bedId: 'R1', patientName: 'Bea Inventada', rut },
          ],
        },
      },
    });
    const handler = createListUploadPatientOptionsHandler({
      firestore: harness.admin.firestore(),
      resolveRoleForEmail: async () => 'nurse_hospital',
    });
    const result = await handler(
      { date },
      { auth: { token: { email: 'synthetic@example.test' } } }
    );
    expect(result.patientOptions.map((o: { patientName: string }) => o.patientName)).toEqual([
      'Ana Inventada',
      'Bea Inventada',
    ]);
    const keys = result.patientOptions.map((o: { key: string }) => o.key);
    expect(keys[0]).toBe(`discharge:R1-${rut || 0}`);
    expect(new Set(keys).size).toBe(2);
    expect(keys[1]).toMatch(/^discharge:/);
  }
);
