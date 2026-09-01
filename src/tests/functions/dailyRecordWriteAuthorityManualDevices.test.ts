import { describe, expect, it, vi } from 'vitest';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from './dailyRecordWriteAuthorityFunctions.test-support';

describe('daily-record clinical fence · edición manual de dispositivos', () => {
  it('acepta la edición manual de dispositivos con la valla activa (enfermería entre corridas)', async () => {
    // Verificado en vivo (31-08): con la valla schema-v2 activa, agregar
    // LA/SNG desde el censo era rechazado («Rayen clinical fields must be
    // written through the authoritative clinical batch») y el dispositivo
    // quedaba solo en local, perdiéndose al recargar. Los dispositivos son
    // datos operacionales de gestión manual; solo las mediciones y el
    // checkpoint quedan vallados (test siguiente).
    const remote = {
      ...makeRecord(),
      dateTimestamp: Date.now(),
      beds: {
        R1: {
          ...makeRecord().beds.R1,
          devices: ['VVP #1'],
          vitalSigns: { systolic: 118 },
        },
      },
    };
    const { admin, update, docRef } = createAdminMock({
      remoteData: remote,
      policyData: { schemaVersion: 2, clinicalBatchMode: 'enforced' },
    });
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
    });

    await functionsApi.patchDailyRecordWithClinicalAuthority.run(
      {
        date: remote.date,
        mode: 'enforced',
        patch: {
          'beds.R1.devices': ['VVP #1', 'LA'],
          'beds.R1.deviceDetails': { LA: { installationDate: '2026-05-13' } },
          'beds.R1.deviceInstanceHistory': [
            { device: 'LA', installationDate: '2026-05-13', active: true },
          ],
        },
      },
      makeContext()
    );

    expect(update).toHaveBeenCalledWith(
      docRef,
      expect.objectContaining({
        'beds.R1.devices': ['VVP #1', 'LA'],
        'beds.R1.deviceDetails': { LA: { installationDate: '2026-05-13' } },
      })
    );
  });
});

describe('daily-record clinical fence · toggle manual de tipo de cama', () => {
  it('un bedTypeOverrides solitario sigue rechazado (pin del contrato de acompañamiento)', async () => {
    const remote = { ...makeRecord(), dateTimestamp: Date.now() };
    const { admin, update } = createAdminMock({
      remoteData: remote,
      policyData: { schemaVersion: 2, clinicalBatchMode: 'enforced' },
    });
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
    });

    await expect(
      functionsApi.patchDailyRecordWithClinicalAuthority.run(
        { date: remote.date, mode: 'enforced', patch: { 'bedTypeOverrides.R1': 'UCI' } },
        makeContext()
      )
    ).rejects.toMatchObject({ message: expect.stringContaining('accompany a UPC patch') });
    expect(update).not.toHaveBeenCalled();
  });

  it('el parche del toggle (override + isUPC acompañante) es aceptado y escrito', async () => {
    // Bug latente confirmado 01-09: el toggle manual UCI/UTI enviaba el
    // override solitario y quedó roto bajo la valla; ahora viaja con isUPC.
    const remote = { ...makeRecord(), dateTimestamp: Date.now() };
    const { admin, update, docRef } = createAdminMock({
      remoteData: remote,
      policyData: { schemaVersion: 2, clinicalBatchMode: 'enforced' },
    });
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
    });

    await functionsApi.patchDailyRecordWithClinicalAuthority.run(
      {
        date: remote.date,
        mode: 'enforced',
        patch: { 'bedTypeOverrides.R1': 'UCI', 'beds.R1.isUPC': false },
      },
      makeContext()
    );

    expect(update).toHaveBeenCalledWith(
      docRef,
      expect.objectContaining({ 'bedTypeOverrides.R1': 'UCI' })
    );
  });
});
