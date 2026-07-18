import { describe, expect, it, vi } from 'vitest';

import {
  buildAdminHarness,
  createSetPinHandler,
  createSubmitHandler,
  seedPin,
} from './prescriptionAccessFunctions.testSupport';

describe('submitPrescriptionPhoto', () => {
  const validPayload = (overrides: Record<string, unknown> = {}) => ({
    pin: '7351',
    prescriptionType: 'comun',
    bedId: 'H5C1',
    patientName: 'Paciente Test',
    patientRut: '11.111.111-1',
    fullImageBase64: Buffer.from('full-image-bytes').toString('base64'),
    thumbnailBase64: Buffer.from('thumb-image-bytes').toString('base64'),
    fullImageWidth: 1200,
    fullImageHeight: 900,
    uploaderDisplayName: 'Estación QR sala',
    ...overrides,
  });

  it('writes Storage blobs + Firestore record on the QR-PIN path', async () => {
    const { admin, accessConfig, writtenPrescriptions, storedBlobs } = buildAdminHarness();
    await seedPin(accessConfig, '7351');

    const handler = createSubmitHandler({
      firestore: admin.firestore(),
      storage: admin.storage(),
      resolveRoleForEmail: vi.fn(),
    });

    const result = await handler(validPayload(), undefined);

    expect(result).toMatchObject({ id: expect.stringMatching(/^rx_/) });
    const id = (result as { id: string }).id;

    const storageEntries = Object.keys(storedBlobs);
    expect(storageEntries).toHaveLength(2);
    expect(storageEntries.some(key => key.endsWith('/full.jpg'))).toBe(true);
    expect(storageEntries.some(key => key.endsWith('/thumb.jpg'))).toBe(true);

    const persisted = writtenPrescriptions[id];
    expect(persisted).toMatchObject({
      id,
      prescriptionType: 'comun',
      bedId: 'H5C1',
      patientName: 'Paciente Test',
      uploader: { source: 'qr_pin', displayName: 'Estación QR sala' },
      createdAt: '2026-05-04T12:00:00.000Z',
      expiresAt: '2026-06-03T12:00:00.000Z',
    });
    expect(persisted.image).toMatchObject({
      contentType: 'image/jpeg',
      width: 1200,
      height: 900,
    });
  });

  it('removes uploaded blobs if the Firestore prescription write fails', async () => {
    const { admin, accessConfig, storedBlobs } = buildAdminHarness({ failPrescriptionWrite: true });
    await seedPin(accessConfig, '7351');

    const handler = createSubmitHandler({
      firestore: admin.firestore(),
      storage: admin.storage(),
      resolveRoleForEmail: vi.fn(),
    });

    await expect(handler(validPayload(), undefined)).rejects.toThrow(
      'forced Firestore write failure'
    );
    expect(Object.keys(storedBlobs)).toHaveLength(0);
  });

  it('accepts an authenticated nurse_hospital caller without PIN', async () => {
    const { admin, writtenPrescriptions } = buildAdminHarness();
    const resolveRoleForEmail = vi.fn().mockResolvedValue('nurse_hospital');

    const handler = createSubmitHandler({
      firestore: admin.firestore(),
      storage: admin.storage(),
      resolveRoleForEmail,
    });
    const payload = validPayload();
    delete (payload as Record<string, unknown>).pin;

    const result = await handler(payload, {
      auth: { uid: 'nurse-1', token: { email: 'enf@h.cl' } },
    });

    const id = (result as { id: string }).id;
    expect(writtenPrescriptions[id].uploader).toMatchObject({
      source: 'authenticated',
      uid: 'nurse-1',
      email: 'enf@h.cl',
    });
  });

  it('rejects an authenticated caller without an allowed role and no PIN', async () => {
    const { admin } = buildAdminHarness();
    const resolveRoleForEmail = vi.fn().mockResolvedValue('viewer');

    const handler = createSubmitHandler({
      firestore: admin.firestore(),
      storage: admin.storage(),
      resolveRoleForEmail,
    });
    const payload = validPayload();
    delete (payload as Record<string, unknown>).pin;

    await expect(
      handler(payload, { auth: { uid: 'visit-1', token: { email: 'visit@h.cl' } } })
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects an unsupported prescription type', async () => {
    const { admin, accessConfig } = buildAdminHarness();
    await seedPin(accessConfig, '7351');
    const handler = createSubmitHandler({
      firestore: admin.firestore(),
      storage: admin.storage(),
      resolveRoleForEmail: vi.fn(),
    });

    await expect(
      handler(validPayload({ prescriptionType: 'antibioticos' }), undefined)
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('persists Stock de Hospitalizados as a non-patient assignment category', async () => {
    const { admin, accessConfig, writtenPrescriptions } = buildAdminHarness();
    await seedPin(accessConfig, '7351');
    const handler = createSubmitHandler({
      firestore: admin.firestore(),
      storage: admin.storage(),
      resolveRoleForEmail: vi.fn(),
    });

    const result = await handler(
      validPayload({
        assignmentScope: 'hospitalized_stock',
        bedId: undefined,
        patientName: undefined,
        patientRut: undefined,
      }),
      undefined
    );

    const id = (result as { id: string }).id;
    expect(writtenPrescriptions[id]).toMatchObject({
      assignmentScope: 'hospitalized_stock',
    });
    expect(writtenPrescriptions[id]).not.toHaveProperty('bedId');
    expect(writtenPrescriptions[id]).not.toHaveProperty('patientName');
    expect(writtenPrescriptions[id]).not.toHaveProperty('patientRut');
  });

  it('rejects oversized image payloads', async () => {
    const { admin, accessConfig } = buildAdminHarness();
    await seedPin(accessConfig, '7351');
    const handler = createSubmitHandler({
      firestore: admin.firestore(),
      storage: admin.storage(),
      resolveRoleForEmail: vi.fn(),
    });

    const tooBig = Buffer.alloc(5 * 1024 * 1024).toString('base64');
    await expect(
      handler(validPayload({ fullImageBase64: tooBig }), undefined)
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

describe('setPrescriptionAccessPin', () => {
  it('hashes and persists the new PIN for admin callers', async () => {
    const { admin, accessConfig } = buildAdminHarness();
    const resolveRoleForEmail = vi.fn().mockResolvedValue('admin');

    const handler = createSetPinHandler({
      firestore: admin.firestore(),
      resolveRoleForEmail,
    });
    await handler(
      { newPin: '835412' },
      {
        auth: { uid: 'a-1', token: { email: 'admin@h.cl' } },
      }
    );

    expect(accessConfig.data).toMatchObject({
      pinUpdatedBy: 'admin@h.cl',
      pinHash: expect.any(String),
      pinSalt: expect.any(String),
      pinHashAlgorithm: 'scrypt',
      failedAttempts: 0,
      lockedUntil: null,
    });
  });

  it('rejects non-admin callers', async () => {
    const { admin } = buildAdminHarness();
    const resolveRoleForEmail = vi.fn().mockResolvedValue('nurse_hospital');

    const handler = createSetPinHandler({
      firestore: admin.firestore(),
      resolveRoleForEmail,
    });
    await expect(
      handler(
        { newPin: '835412' },
        {
          auth: { uid: 'n-1', token: { email: 'enf@h.cl' } },
        }
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects unauthenticated callers', async () => {
    const { admin } = buildAdminHarness();
    const handler = createSetPinHandler({
      firestore: admin.firestore(),
      resolveRoleForEmail: vi.fn(),
    });
    await expect(handler({ newPin: '835412' }, undefined)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
});
