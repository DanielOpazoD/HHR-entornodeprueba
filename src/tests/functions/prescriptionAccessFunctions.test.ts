import { describe, expect, it, vi } from 'vitest';

import {
  buildAdminHarness,
  createValidatePinHandler,
  createListUploadPatientOptionsHandler,
  createListUploadReadonlyRecordsHandler,
  seedPin,
  hashPin,
  hashPinLegacySha256,
  computeExpiresAt,
  resolveUploadPatientOptionForExactDate,
} from './prescriptionAccessFunctions.testSupport';

describe('hashPin / computeExpiresAt', () => {
  it('produces stable hashes for the same pin + salt and different ones for different pins', async () => {
    const salt = 'abc123';
    expect(await hashPin('1234', salt)).toBe(await hashPin('1234', salt));
    expect(await hashPin('1234', salt)).not.toBe(await hashPin('5678', salt));
    expect(await hashPin('1234', salt)).not.toBe(hashPinLegacySha256('1234', salt));
  });

  it('computes the monthly backup review date 30 days after createdAt for known types', () => {
    const expiry = computeExpiresAt('comun', '2026-05-04T12:00:00.000Z');
    expect(expiry).toBe('2026-06-03T12:00:00.000Z');
  });
});

const buildPrescriptionRecord = (id: string, createdAt: string) => ({
  id,
  hospitalId: 'hhr',
  prescriptionType: 'comun',
  assignmentScope: 'patient',
  bedId: 'H5C1',
  patientName: `Paciente ${id}`,
  patientRut: '11.111.111-1',
  image: {
    storagePath: `prescriptions/hhr/${id}/full.jpg`,
    thumbnailStoragePath: `prescriptions/hhr/${id}/thumb.jpg`,
    byteSize: 120000,
    width: 1200,
    height: 900,
    contentType: 'image/jpeg',
  },
  uploader: { source: 'qr_pin', displayName: 'Farmacia' },
  createdAt,
  expiresAt: '2026-06-03T12:00:00.000Z',
});

describe('validatePrescriptionAccessPin', () => {
  it('returns valid:true when the candidate PIN matches the configured hash', async () => {
    const { admin, accessConfig } = buildAdminHarness();
    await seedPin(accessConfig, '7351');

    const handler = createValidatePinHandler({ firestore: admin.firestore() });
    const result = await handler({ pin: '7351' }, undefined);

    expect(result).toEqual({ valid: true });
  });

  it('rejects when the PIN is wrong', async () => {
    const { admin, accessConfig } = buildAdminHarness();
    await seedPin(accessConfig, '7351');

    const handler = createValidatePinHandler({ firestore: admin.firestore() });
    await expect(handler({ pin: '0000' }, undefined)).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('rejects when no PIN is configured yet', async () => {
    const { admin } = buildAdminHarness();
    const handler = createValidatePinHandler({ firestore: admin.firestore() });
    await expect(handler({ pin: '7351' }, undefined)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('rejects malformed PIN input (empty, too short, too long)', async () => {
    const { admin, accessConfig } = buildAdminHarness();
    await seedPin(accessConfig, '7351');
    const handler = createValidatePinHandler({ firestore: admin.firestore() });

    await expect(handler({ pin: '' }, undefined)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(handler({ pin: '12' }, undefined)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(handler({ pin: '1'.repeat(20) }, undefined)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('locks the PIN endpoint for 15 min after 5 consecutive wrong attempts', async () => {
    const { admin, accessConfig } = buildAdminHarness();
    await seedPin(accessConfig, '7351');
    const handler = createValidatePinHandler({ firestore: admin.firestore() });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(handler({ pin: '0000' }, undefined)).rejects.toMatchObject({
        code: 'permission-denied',
      });
    }

    await expect(handler({ pin: '7351' }, undefined)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(accessConfig.data?.lockedUntil).toBeTruthy();
  });

  it('clears the failure counter when the PIN finally matches', async () => {
    const { admin, accessConfig } = buildAdminHarness();
    await seedPin(accessConfig, '7351');
    const handler = createValidatePinHandler({ firestore: admin.firestore() });

    await expect(handler({ pin: '0000' }, undefined)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(handler({ pin: '0001' }, undefined)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(accessConfig.data?.failedAttempts).toBe(2);

    await handler({ pin: '7351' }, undefined);
    expect(accessConfig.data?.failedAttempts).toBe(0);
    expect(accessConfig.data?.lockedUntil).toBeNull();
  });

  it('allows retries again once the lockout window has elapsed', async () => {
    const { admin, accessConfig } = buildAdminHarness();
    await seedPin(accessConfig, '7351');
    accessConfig.data = {
      ...accessConfig.data,
      failedAttempts: 0,
      lockedUntil: '2026-05-04T11:59:00.000Z',
    };

    const handler = createValidatePinHandler({ firestore: admin.firestore() });
    await expect(handler({ pin: '7351' }, undefined)).resolves.toEqual({ valid: true });
  });
});

describe('listPrescriptionUploadPatientOptions', () => {
  const dailyRecord = {
    date: '2026-05-05',
    beds: {
      H5C1: {
        patientName: 'Paciente Uno',
        rut: '11.111.111-1',
        isBlocked: false,
      },
      H5C2: {
        patientName: 'Paciente Dos',
        rut: '22.222.222-2',
        isBlocked: false,
      },
      H5C3: {
        patientName: 'Bloqueado',
        rut: '33.333.333-3',
        isBlocked: true,
      },
      H5C4: {
        patientName: '',
        rut: '',
        isBlocked: false,
      },
    },
  };

  it('resolves the selected identity from the exact census date instead of trusting the client', async () => {
    const { admin } = buildAdminHarness({
      dailyRecords: { '2026-05-02': dailyRecord },
    });

    await expect(
      resolveUploadPatientOptionForExactDate(
        admin.firestore(),
        '2026-05-03',
        '2026-05-02',
        'H5C2',
        '22.222.222-2'
      )
    ).resolves.toEqual({
      sourceDate: '2026-05-02',
      patient: {
        key: 'H5C2',
        bedId: 'H5C2',
        patientName: 'Paciente Dos',
        patientRut: '22.222.222-2',
        patientStatus: 'active',
      },
    });
  });

  it('rejects a patient option key that is not present in that census date', async () => {
    const { admin } = buildAdminHarness({
      dailyRecords: { '2026-05-04': dailyRecord },
    });

    await expect(
      resolveUploadPatientOptionForExactDate(
        admin.firestore(),
        '2026-05-04',
        '2026-05-04',
        'H9C9',
        '99.999.999-9'
      )
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects a fallback date once the requested census becomes canonical', async () => {
    const { admin } = buildAdminHarness({
      dailyRecords: {
        '2026-05-03': dailyRecord,
        '2026-05-04': dailyRecord,
      },
    });

    await expect(
      resolveUploadPatientOptionForExactDate(
        admin.firestore(),
        '2026-05-04',
        '2026-05-03',
        'H5C2',
        '22.222.222-2'
      )
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects the selection when the same bed now belongs to a different RUN', async () => {
    const { admin } = buildAdminHarness({
      dailyRecords: { '2026-05-04': dailyRecord },
    });

    await expect(
      resolveUploadPatientOptionForExactDate(
        admin.firestore(),
        '2026-05-04',
        '2026-05-04',
        'H5C2',
        '11.111.111-1'
      )
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects historical census dates even when the patient key existed', async () => {
    const { admin } = buildAdminHarness({
      dailyRecords: { '2026-04-01': dailyRecord },
    });

    await expect(
      resolveUploadPatientOptionForExactDate(
        admin.firestore(),
        '2026-04-01',
        '2026-04-01',
        'H5C2',
        '22.222.222-2'
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('returns active bed-patient options for a valid QR PIN', async () => {
    const { admin, accessConfig } = buildAdminHarness({
      dailyRecords: { '2026-05-05': dailyRecord },
    });
    await seedPin(accessConfig, '7351');

    const handler = createListUploadPatientOptionsHandler({
      firestore: admin.firestore(),
      storage: admin.storage(),
      resolveRoleForEmail: vi.fn(),
    });

    await expect(handler({ pin: '7351', date: '2026-05-05' }, undefined)).resolves.toEqual({
      date: '2026-05-05',
      sourceDate: '2026-05-05',
      isFallbackFromPreviousDay: false,
      patientOptions: [
        {
          key: 'H5C1',
          bedId: 'H5C1',
          patientName: 'Paciente Uno',
          patientRut: '11.111.111-1',
          patientStatus: 'active',
        },
        {
          key: 'H5C2',
          bedId: 'H5C2',
          patientName: 'Paciente Dos',
          patientRut: '22.222.222-2',
          patientStatus: 'active',
        },
      ],
    });
  });

  it('falls back to previous-day patients when the requested census has no active patients', async () => {
    const { admin, accessConfig } = buildAdminHarness({
      dailyRecords: {
        '2026-05-04': dailyRecord,
        '2026-05-05': { date: '2026-05-05', beds: {} },
      },
    });
    await seedPin(accessConfig, '7351');

    const handler = createListUploadPatientOptionsHandler({
      firestore: admin.firestore(),
      storage: admin.storage(),
      resolveRoleForEmail: vi.fn(),
    });

    await expect(handler({ pin: '7351', date: '2026-05-05' }, undefined)).resolves.toEqual({
      date: '2026-05-05',
      sourceDate: '2026-05-04',
      isFallbackFromPreviousDay: true,
      patientOptions: [
        {
          key: 'H5C1',
          bedId: 'H5C1',
          patientName: 'Paciente Uno',
          patientRut: '11.111.111-1',
          patientStatus: 'active',
        },
        {
          key: 'H5C2',
          bedId: 'H5C2',
          patientName: 'Paciente Dos',
          patientRut: '22.222.222-2',
          patientStatus: 'active',
        },
      ],
    });
  });

  it('keeps same-day discharged and transferred patients in the upload selector', async () => {
    const { admin, accessConfig } = buildAdminHarness({
      dailyRecords: {
        '2026-05-05': {
          ...dailyRecord,
          discharges: [
            {
              id: 'discharge-1',
              bedId: 'H5C5',
              bedName: 'H5C5',
              patientName: 'Paciente Alta',
              rut: '44.444.444-4',
              isBlocked: false,
            },
          ],
          transfers: [
            {
              id: 'transfer-1',
              bedId: 'H5C6',
              bedName: 'H5C6',
              patientName: 'Paciente Traslado',
              rut: '55.555.555-5',
              isBlocked: false,
            },
          ],
        },
      },
    });
    await seedPin(accessConfig, '7351');

    const handler = createListUploadPatientOptionsHandler({
      firestore: admin.firestore(),
      storage: admin.storage(),
      resolveRoleForEmail: vi.fn(),
    });

    await expect(handler({ pin: '7351', date: '2026-05-05' }, undefined)).resolves.toMatchObject({
      date: '2026-05-05',
      sourceDate: '2026-05-05',
      isFallbackFromPreviousDay: false,
      patientOptions: expect.arrayContaining([
        {
          key: 'discharge:discharge-1',
          bedId: 'H5C5',
          patientName: 'Paciente Alta',
          patientRut: '44.444.444-4',
          patientStatus: 'discharge',
        },
        {
          key: 'transfer:transfer-1',
          bedId: 'H5C6',
          patientName: 'Paciente Traslado',
          patientRut: '55.555.555-5',
          patientStatus: 'transfer',
        },
      ]),
    });
  });

  it('allows authenticated nursing callers without a PIN', async () => {
    const { admin } = buildAdminHarness({
      dailyRecords: { '2026-05-05': dailyRecord },
    });
    const resolveRoleForEmail = vi.fn().mockResolvedValue('nurse_hospital');
    const handler = createListUploadPatientOptionsHandler({
      firestore: admin.firestore(),
      resolveRoleForEmail,
    });

    const result = await handler(
      { date: '2026-05-05' },
      { auth: { uid: 'n-1', token: { email: 'enf@h.cl' } } }
    );

    expect(result.patientOptions).toHaveLength(2);
    expect(resolveRoleForEmail).toHaveBeenCalledWith('enf@h.cl');
  });

  it('rejects unauthenticated calls without a PIN', async () => {
    const { admin } = buildAdminHarness();
    const handler = createListUploadPatientOptionsHandler({
      firestore: admin.firestore(),
      storage: admin.storage(),
      resolveRoleForEmail: vi.fn(),
    });

    await expect(handler({ date: '2026-05-05' }, undefined)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });
});

describe('listPrescriptionUploadReadonlyRecords', () => {
  it('returns today prescription records with download URLs for a valid QR PIN', async () => {
    const { admin, accessConfig } = buildAdminHarness({
      prescriptionRecords: {
        'rx-today': buildPrescriptionRecord('rx-today', '2026-05-04T10:00:00.000Z'),
        'rx-yesterday': buildPrescriptionRecord('rx-yesterday', '2026-05-03T10:00:00.000Z'),
      },
    });
    await seedPin(accessConfig, '7351');

    const handler = createListUploadReadonlyRecordsHandler({
      firestore: admin.firestore(),
      storage: admin.storage(),
      resolveRoleForEmail: vi.fn(),
    });

    const result = await handler({ pin: '7351', date: '2026-05-04' }, undefined);

    expect(result.date).toBe('2026-05-04');
    expect(result.records.map((record: { id: string }) => record.id)).toEqual(['rx-today']);
    expect(result.records[0].image.fullDownloadUrl).toMatch(
      /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/hhr-test\.appspot\.com\/o\//
    );
    expect(result.records[0].image.thumbnailDownloadUrl).toContain('alt=media');
  });

  it('limits QR readonly access to today and yesterday', async () => {
    const { admin, accessConfig } = buildAdminHarness();
    await seedPin(accessConfig, '7351');
    const handler = createListUploadReadonlyRecordsHandler({
      firestore: admin.firestore(),
      storage: admin.storage(),
      resolveRoleForEmail: vi.fn(),
    });

    await expect(handler({ pin: '7351', date: '2026-05-02' }, undefined)).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('allows authenticated nursing callers without a PIN', async () => {
    const { admin } = buildAdminHarness({
      prescriptionRecords: {
        'rx-today': buildPrescriptionRecord('rx-today', '2026-05-04T10:00:00.000Z'),
      },
    });
    const resolveRoleForEmail = vi.fn().mockResolvedValue('nurse_hospital');
    const handler = createListUploadReadonlyRecordsHandler({
      firestore: admin.firestore(),
      storage: admin.storage(),
      resolveRoleForEmail,
    });

    const result = await handler(
      { date: '2026-05-04' },
      { auth: { uid: 'n-1', token: { email: 'enf@h.cl' } } }
    );

    expect(result.records).toHaveLength(1);
    expect(resolveRoleForEmail).toHaveBeenCalledWith('enf@h.cl');
  });
});
