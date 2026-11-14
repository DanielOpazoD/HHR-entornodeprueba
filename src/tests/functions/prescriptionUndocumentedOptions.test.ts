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
    // Without a document the fallback key is the row position; with the same marker both rows
    // share one fallback key, so both are keyed by name.
    expect(keys).toEqual(
      rut
        ? [`discharge:R1-${rut}:ana inventada`, `discharge:R1-${rut}:bea inventada`]
        : ['discharge:R1-0', 'discharge:R1-1']
    );
  }
);

describe('server option keys between listing and uploading', () => {
  const legacyDischarges = [
    { bedId: 'R1', patientName: 'Ana Inventada', rut: 'RN' },
    { bedId: 'R1', patientName: 'Bea Ficticia', rut: 'RN' },
    { bedId: 'R1', patientName: 'Ceci Sintética', rut: 'RN' },
  ];
  const list = async (record: Record<string, unknown>) => {
    const harness = buildAdminHarness({ dailyRecords: { [date]: record } });
    const handler = createListUploadPatientOptionsHandler({
      firestore: harness.admin.firestore(),
      resolveRoleForEmail: async () => 'nurse_hospital',
    });
    const result = await handler(
      { date },
      { auth: { token: { email: 'synthetic@example.test' } } }
    );
    return result.patientOptions as { key: string; bedId: string; patientName: string }[];
  };

  it('keeps naming the same person after an unrelated admission', async () => {
    const before = await list({ beds: {}, discharges: legacyDischarges });
    const after = await list({
      beds: { R5: { patientName: 'Dina Prueba', rut: '12.345.678-5' } },
      discharges: legacyDischarges,
    });
    expect(new Set(before.map(option => option.key)).size).toBe(3);
    for (const option of before) {
      expect(after.find(candidate => candidate.key === option.key)?.patientName).toBe(
        option.patientName
      );
    }
  });

  it('never hands a key to another person when the first of the group leaves', async () => {
    const withBeaInBed = {
      beds: { R1: { patientName: 'Bea Ficticia', rut: '' } },
      discharges: [
        { bedId: 'R1', patientName: 'Bea Ficticia', rut: 'RN' },
        { bedId: 'R1', patientName: 'Ceci Sintética', rut: 'RN' },
      ],
    };
    const firstDischargeDeleted = {
      beds: {},
      discharges: [
        { ...legacyDischarges[0], deletedAt: '2026-05-04T10:00:00Z' },
        legacyDischarges[1],
        legacyDischarges[2],
      ],
    };
    for (const [before, after] of [
      [withBeaInBed, { ...withBeaInBed, beds: {} }],
      [{ beds: {}, discharges: legacyDischarges }, firstDischargeDeleted],
    ]) {
      const listed = await list(before);
      const later = await list(after);
      for (const option of listed) {
        const sameKey = later.find(candidate => candidate.key === option.key);
        if (sameKey) expect(sameKey.patientName).toBe(option.patientName);
      }
    }
  });

  it('does not offer a deleted movement', async () => {
    const options = await list({
      beds: { R1: { patientName: 'Ana Inventada', rut: '' } },
      discharges: [
        {
          id: 'd1',
          bedId: 'R1',
          patientName: 'Bea Ficticia',
          rut: '',
          deletedAt: '2026-05-04T10:00:00Z',
        },
        {
          id: 'd2',
          bedId: 'R1',
          patientName: 'Ceci Sintética',
          rut: '12.345.678-5',
          deletedAt: '2026-05-04T11:00:00Z',
        },
        { id: 'd3', bedId: 'R1', patientName: 'Dina Prueba', rut: '' },
      ],
    });
    expect(options.map(option => option.patientName)).toEqual(['Ana Inventada', 'Dina Prueba']);
  });
});
