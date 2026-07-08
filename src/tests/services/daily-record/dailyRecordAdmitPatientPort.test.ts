import { describe, expect, it, vi } from 'vitest';
import {
  buildAdmitPatientPatch,
  createDailyRecordAdmitPatientPort,
  type AdmitPatientPersistenceFn,
} from '@/services/daily-record/dailyRecordAdmitPatientPort';
import type { AdmitPatientInput } from '@/application/daily-record/commands/admitPatientCommand';
import { createUpdatePartialDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';

const baseInput = (overrides: Partial<AdmitPatientInput> = {}): AdmitPatientInput => ({
  bedId: 'H5C1',
  patientName: 'Paciente Demo',
  rut: '11.111.111-1',
  pathology: 'Diagnóstico demo',
  admissionDate: '2026-05-03',
  recordDate: '2026-05-03',
  actor: 'nurse@hospital.cl',
  ...overrides,
});

describe('buildAdmitPatientPatch', () => {
  it('emits paths scoped to the target bedId for the four admission fields', () => {
    expect(buildAdmitPatientPatch(baseInput({ clinicalEpisodeId: 'ep-admission' }))).toEqual({
      'beds.H5C1.patientName': 'Paciente Demo',
      'beds.H5C1.rut': '11.111.111-1',
      'beds.H5C1.admissionDate': '2026-05-03',
      'beds.H5C1.pathology': 'Diagnóstico demo',
      'beds.H5C1.clinicalEpisodeId': 'ep-admission',
    });
  });

  it('omits pathology when not supplied', () => {
    const patch = buildAdmitPatientPatch(baseInput({ pathology: undefined }));
    expect(patch).toMatchObject({
      'beds.H5C1.patientName': 'Paciente Demo',
      'beds.H5C1.rut': '11.111.111-1',
      'beds.H5C1.admissionDate': '2026-05-03',
      'beds.H5C1.clinicalEpisodeId': expect.stringMatching(/^ep_/),
    });
    expect(Object.keys(patch)).not.toContain('beds.H5C1.pathology');
  });

  it('emits an empty pathology string when explicitly cleared', () => {
    const patch = buildAdmitPatientPatch(baseInput({ pathology: '' })) as Record<string, unknown>;
    expect(patch['beds.H5C1.pathology']).toBe('');
  });
});

describe('createDailyRecordAdmitPatientPort', () => {
  it('persists the patch through the injected persistence fn and returns a snapshot of the input', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const port = createDailyRecordAdmitPatientPort(persist);

    const input = baseInput();
    const snapshot = await port.persistAdmission(input);

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith('2026-05-03', {
      'beds.H5C1.patientName': 'Paciente Demo',
      'beds.H5C1.rut': '11.111.111-1',
      'beds.H5C1.admissionDate': '2026-05-03',
      'beds.H5C1.pathology': 'Diagnóstico demo',
      'beds.H5C1.clinicalEpisodeId': expect.stringMatching(/^ep_/),
    });
    expect(snapshot).toEqual({
      bedId: 'H5C1',
      patientName: 'Paciente Demo',
      rut: '11.111.111-1',
      admissionDate: '2026-05-03',
      recordDate: '2026-05-03',
      clinicalEpisodeId: expect.stringMatching(/^ep_/),
    });
    const persistedPatch = persist.mock.calls[0][1] as Record<string, unknown>;
    expect(snapshot.clinicalEpisodeId).toBe(persistedPatch['beds.H5C1.clinicalEpisodeId']);
  });

  it('passes the visible census record as the write base when admission receives one', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const port = createDailyRecordAdmitPatientPort(persist);
    const baseRecord: NonNullable<AdmitPatientInput['baseRecord']> = {
      date: '2026-05-03',
      lastUpdated: '2026-05-03T09:00:00.000Z',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      activeExtraBeds: [],
    };

    await port.persistAdmission(baseInput({ baseRecord }));

    expect(persist).toHaveBeenCalledWith(
      '2026-05-03',
      expect.objectContaining({
        'beds.H5C1.patientName': 'Paciente Demo',
      }),
      { baseRecord }
    );
  });

  it('lets the persistence error surface to the caller (caught by the command)', async () => {
    const persist = vi.fn().mockRejectedValueOnce(new Error('Firestore offline'));
    const port = createDailyRecordAdmitPatientPort(persist);

    await expect(port.persistAdmission(baseInput())).rejects.toThrow('Firestore offline');
  });

  it('rejects a blocked repository outcome instead of returning an admitted snapshot', async () => {
    const persist = vi.fn().mockResolvedValueOnce(
      createUpdatePartialDailyRecordResult({
        date: '2026-05-03',
        outcome: 'blocked',
        savedLocally: false,
        updatedRemotely: false,
        queuedForRetry: false,
        autoMerged: false,
        patchedFields: 4,
        consistencyState: 'unrecoverable',
        userSafeMessage: 'No se encontró un registro local válido para aplicar el cambio.',
      })
    ) as unknown as AdmitPatientPersistenceFn;
    const port = createDailyRecordAdmitPatientPort(persist);

    await expect(port.persistAdmission(baseInput())).rejects.toThrow(
      'No se encontró un registro local válido para aplicar el cambio.'
    );
  });

  it('rejects an unrecoverable repository outcome instead of returning an admitted snapshot', async () => {
    const persist = vi.fn().mockResolvedValueOnce(
      createUpdatePartialDailyRecordResult({
        date: '2026-05-03',
        outcome: 'unrecoverable',
        savedLocally: false,
        updatedRemotely: false,
        queuedForRetry: false,
        autoMerged: false,
        patchedFields: 4,
        consistencyState: 'unrecoverable',
        userSafeMessage: 'La escritura no pudo recuperarse de forma segura.',
      })
    ) as unknown as AdmitPatientPersistenceFn;
    const port = createDailyRecordAdmitPatientPort(persist);

    await expect(port.persistAdmission(baseInput())).rejects.toThrow(
      'La escritura no pudo recuperarse de forma segura.'
    );
  });
});
