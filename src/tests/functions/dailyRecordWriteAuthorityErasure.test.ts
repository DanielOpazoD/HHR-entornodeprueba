import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

const makeCanonicalEmptyBed = (bedId = 'R1', location = '') => ({
  bedId,
  isBlocked: false,
  blockedReason: '',
  bedMode: 'Cama',
  hasCompanionCrib: false,
  clinicalCrib: null,
  patientName: '',
  firstName: '',
  lastName: '',
  secondLastName: '',
  identityStatus: 'official',
  rut: '',
  clinicalEpisodeId: '',
  documentType: 'RUT',
  age: '',
  birthDate: '',
  biologicalSex: 'Indeterminado',
  insurance: null,
  admissionOrigin: null,
  admissionOriginDetails: '',
  origin: null,
  isRapanui: false,
  pathology: '',
  cie10Code: null,
  cie10Description: null,
  treatingPhysicianId: null,
  treatingPhysicianName: null,
  specialty: '',
  ginecobstetriciaType: null,
  status: '',
  admissionDate: '',
  admissionTime: '',
  hasWristband: true,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
  location,
  handoffNote: '',
  handoffNoteDayShift: '',
  handoffNoteNightShift: '',
  medicalHandoffNote: '',
  medicalHandoffAudit: null,
  medicalHandoffEntries: [],
  clinicalEvents: [],
  firstSeenDate: null,
  deliveryRoute: null,
  deliveryDate: null,
  deliveryCesareanLabor: null,
});

const makeClearableRecord = () => ({
  ...makeRecord(),
  beds: {
    R1: {
      ...makeRecord().beds.R1,
      bedMode: 'Cama',
      location: '',
    },
  },
});

describe('dailyRecordWriteAuthorityFunctions erasure guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects full saves that would erase a patient present in the cloud', async () => {
    const { admin, set } = createAdminMock({
      remoteData: {
        ...makeRecord(),
        lastUpdated: '2026-05-13T10:00:00.000Z',
        beds: {
          R1: makeRecord().beds.R1,
          R2: {
            bedId: 'R2',
            patientName: 'Paciente Dos',
            rut: '22.222.222-2',
            admissionDate: '2026-05-13',
            admissionTime: '09:00',
            clinicalEpisodeId: 'ep-dos',
            isBlocked: false,
          },
        },
      },
    });
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
    });

    // The incoming record only has R1, so R2's cloud patient would be erased — and there is no
    // movement accounting for it. The in-transaction guard must block the write.
    await expect(
      functionsApi.saveDailyRecordWithClinicalAuthority.run(
        {
          date: '2026-05-13',
          expectedLastUpdated: '2026-05-13T10:00:00.000Z',
          mode: 'enforced',
          origin: 'outbox',
          record: makeRecord(),
        },
        makeContext()
      )
    ).rejects.toMatchObject({
      code: 'failed-precondition',
    });

    expect(set).not.toHaveBeenCalled();
  });

  it('allows an authorized exact-version clear of exactly one declared bed', async () => {
    const remote = {
      ...makeClearableRecord(),
      dateTimestamp: Date.now(),
      meta: { revision: 4, lastMutationId: 'previous' },
    };
    const emptyBed = makeCanonicalEmptyBed();
    const { admin, set, docRef, historyDoc } = createAdminMock({
      remoteData: remote,
      policyData: { schemaVersion: 2, clinicalBatchMode: 'enforced' },
    });
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
    });

    const result = await functionsApi.patchDailyRecordWithClinicalAuthority.run(
      {
        date: remote.date,
        expectedLastUpdated: remote.lastUpdated,
        mode: 'enforced',
        origin: 'direct_partial_update',
        historyPolicy: 'skip',
        intentionalBedClear: { bedId: 'R1', confirmedLastUpdated: remote.lastUpdated },
        syncContract: {
          expectedVersion: remote.lastUpdated,
          changedPaths: ['beds.R1'],
          mutationId: 'clear-r1',
        },
        patch: { 'beds.R1': emptyBed },
      },
      makeContext()
    );

    expect(result).toMatchObject({ success: true, mutationId: 'clear-r1' });
    expect(set).toHaveBeenCalledWith(
      historyDoc,
      expect.objectContaining({
        beds: { R1: expect.objectContaining({ patientName: 'Paciente Uno' }) },
      })
    );
    expect(set).toHaveBeenCalledWith(
      docRef,
      expect.objectContaining({
        beds: { R1: emptyBed },
        meta: expect.objectContaining({ revision: 5, lastMutationId: 'clear-r1' }),
      })
    );
  });

  it('keeps blocking a whole-bed patient erasure without the explicit clear intent', async () => {
    const remote = {
      ...makeClearableRecord(),
      dateTimestamp: Date.now(),
    };
    const { admin, set } = createAdminMock({
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
        {
          date: remote.date,
          expectedLastUpdated: remote.lastUpdated,
          mode: 'enforced',
          patch: {
            'beds.R1': {
              bedId: 'R1',
              patientName: '',
              rut: '',
              clinicalEpisodeId: '',
              isBlocked: false,
            },
          },
        },
        makeContext()
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });

    expect(set).not.toHaveBeenCalled();
  });

  it('rejects clear intent that retains clinical content under blank identifiers', async () => {
    const remote = {
      ...makeClearableRecord(),
      dateTimestamp: Date.now(),
    };
    const { admin, set } = createAdminMock({
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
        {
          date: remote.date,
          expectedLastUpdated: remote.lastUpdated,
          mode: 'enforced',
          intentionalBedClear: { bedId: 'R1', confirmedLastUpdated: remote.lastUpdated },
          patch: {
            'beds.R1': {
              ...makeCanonicalEmptyBed(),
              pathology: 'Contenido que no debe sobrevivir a la limpieza',
            },
          },
        },
        makeContext()
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });

    expect(set).not.toHaveBeenCalled();
  });

  it('rejects a clear that attempts to change the remote bed mode', async () => {
    const remote = {
      ...makeClearableRecord(),
      dateTimestamp: Date.now(),
    };
    const { admin, set } = createAdminMock({
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
        {
          date: remote.date,
          expectedLastUpdated: remote.lastUpdated,
          mode: 'enforced',
          intentionalBedClear: { bedId: 'R1', confirmedLastUpdated: remote.lastUpdated },
          patch: {
            'beds.R1': { ...makeCanonicalEmptyBed('R1', ''), bedMode: 'Cuna' },
          },
        },
        makeContext()
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });

    expect(set).not.toHaveBeenCalled();
  });

  it('rejects an intentional clear when the remote version is not an exact match', async () => {
    const remote = {
      ...makeClearableRecord(),
      dateTimestamp: Date.now(),
      lastUpdated: '2026-05-13T10:00:05.000Z',
    };
    const { admin, set } = createAdminMock({
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
        {
          date: remote.date,
          expectedLastUpdated: '2026-05-13T10:00:00.000Z',
          mode: 'enforced',
          intentionalBedClear: {
            bedId: 'R1',
            confirmedLastUpdated: '2026-05-13T10:00:00.000Z',
          },
          patch: {
            'beds.R1': {
              bedId: 'R1',
              patientName: '',
              rut: '',
              clinicalEpisodeId: '',
              isBlocked: false,
            },
          },
        },
        makeContext()
      )
    ).rejects.toMatchObject({ code: 'aborted' });

    expect(set).not.toHaveBeenCalled();
  });

  it('rejects a clear when the user confirmed an older census version', async () => {
    const remote = {
      ...makeClearableRecord(),
      dateTimestamp: Date.now(),
    };
    const { admin, set } = createAdminMock({
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
        {
          date: remote.date,
          expectedLastUpdated: remote.lastUpdated,
          mode: 'enforced',
          intentionalBedClear: {
            bedId: 'R1',
            confirmedLastUpdated: '2026-05-13T09:59:59.000Z',
          },
          patch: { 'beds.R1': makeCanonicalEmptyBed() },
        },
        makeContext()
      )
    ).rejects.toMatchObject({ code: 'aborted' });

    expect(set).not.toHaveBeenCalled();
  });

  it('rejects clear intent that includes any second bed mutation', async () => {
    const remote = {
      ...makeRecord(),
      dateTimestamp: Date.now(),
      beds: {
        ...makeRecord().beds,
        R2: {
          ...makeRecord().beds.R1,
          bedId: 'R2',
          patientName: 'Paciente Dos',
          rut: '22.222.222-2',
          clinicalEpisodeId: 'ep-dos',
        },
      },
    };
    const { admin, set } = createAdminMock({
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
        {
          date: remote.date,
          expectedLastUpdated: remote.lastUpdated,
          mode: 'enforced',
          intentionalBedClear: { bedId: 'R1', confirmedLastUpdated: remote.lastUpdated },
          patch: {
            'beds.R1': {
              bedId: 'R1',
              patientName: '',
              rut: '',
              clinicalEpisodeId: '',
              isBlocked: false,
            },
            'beds.R2': {
              bedId: 'R2',
              patientName: '',
              rut: '',
              clinicalEpisodeId: '',
              isBlocked: false,
            },
          },
        },
        makeContext()
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });

    expect(set).not.toHaveBeenCalled();
  });
});
