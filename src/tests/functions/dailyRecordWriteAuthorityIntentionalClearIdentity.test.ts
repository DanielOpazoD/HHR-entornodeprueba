import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { sanitizeForFirestore } from '@/services/storage/firestore/firestoreShared';

const makeCanonicalEmptyBed = () => ({
  bedId: 'R1',
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
  location: '',
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

const executeClear = async ({
  remoteBed,
  confirmedOccupant,
  confirmedAssociatedCrib,
  requestVersion,
  requestedBed = makeCanonicalEmptyBed(),
}: {
  remoteBed: Record<string, unknown>;
  confirmedOccupant?: Record<string, unknown>;
  confirmedAssociatedCrib?: Record<string, unknown> | null;
  requestVersion?: string;
  requestedBed?: Record<string, unknown>;
}) => {
  const base = makeRecord();
  const remote = {
    ...base,
    dateTimestamp: Date.now(),
    beds: { R1: { ...base.beds.R1, ...remoteBed, bedMode: 'Cama', location: '' } },
  };
  const { admin, set, update } = createAdminMock({
    remoteData: remote,
    policyData: { schemaVersion: 2, clinicalBatchMode: 'enforced' },
  });
  const functionsApi = createDailyRecordWriteAuthorityFunctions({
    firestore: admin.firestore(),
    Timestamp: admin.firestore.Timestamp,
    resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
  });
  const result = functionsApi.patchDailyRecordWithClinicalAuthority.run(
    {
      date: remote.date,
      expectedLastUpdated: requestVersion ?? remote.lastUpdated,
      mode: 'enforced',
      intentionalBedClear: {
        bedId: 'R1',
        confirmedLastUpdated: requestVersion ?? remote.lastUpdated,
        confirmedOccupant,
        ...(confirmedAssociatedCrib !== undefined ? { confirmedAssociatedCrib } : {}),
      },
      patch: { 'beds.R1': requestedBed },
    },
    makeContext()
  );
  return { result, set, update };
};

describe('daily record intentional clear occupant identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects two different episode ids even when their legacy tuple matches', async () => {
    const { result, set, update } = await executeClear({
      remoteBed: { clinicalEpisodeId: 'legacy-remote' },
      confirmedOccupant: {
        clinicalEpisodeId: 'legacy-confirmed',
        rut: '11.111.111-1',
        admissionDate: '2026-05-13',
        admissionTime: '08:00',
      },
    });

    await expect(result).rejects.toMatchObject({ code: 'aborted' });
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a one-sided episode id instead of falling back to legacy fields', async () => {
    const { result, set, update } = await executeClear({
      remoteBed: { clinicalEpisodeId: '' },
      confirmedOccupant: {
        clinicalEpisodeId: 'ep-confirmed',
        rut: '11.111.111-1',
        admissionDate: '2026-05-13',
        admissionTime: '08:00',
      },
    });

    await expect(result).rejects.toMatchObject({ code: 'aborted' });
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a same-name legacy occupant with a different admission time', async () => {
    const { result, set, update } = await executeClear({
      remoteBed: {
        clinicalEpisodeId: '',
        rut: '',
        patientName: 'Paciente legado',
        admissionDate: '2026-05-13',
        admissionTime: '11:00',
      },
      confirmedOccupant: {
        patientName: 'Paciente legado',
        admissionDate: '2026-05-13',
        admissionTime: '08:00',
      },
    });

    await expect(result).rejects.toMatchObject({ code: 'aborted' });
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('allows a name-only legacy occupant at the exact confirmed version', async () => {
    const { result, update } = await executeClear({
      remoteBed: {
        clinicalEpisodeId: '',
        rut: '',
        patientName: 'Paciente legado',
        firstSeenDate: null,
        admissionDate: '',
        admissionTime: '',
      },
      confirmedOccupant: { patientName: 'Paciente legado' },
    });

    await expect(result).resolves.toMatchObject({ success: true });
    expect(update).toHaveBeenCalled();
  });

  it('allows a matching RUT without dates at the exact confirmed version', async () => {
    const { result, update } = await executeClear({
      remoteBed: {
        clinicalEpisodeId: '',
        rut: '11.111.111-1',
        firstSeenDate: null,
        admissionDate: '',
        admissionTime: '',
      },
      confirmedOccupant: { rut: '11.111.111-1' },
    });

    await expect(result).resolves.toMatchObject({ success: true });
    expect(update).toHaveBeenCalled();
  });

  it('keeps exact-version compatibility with an already-loaded legacy client', async () => {
    const { result, update } = await executeClear({
      remoteBed: {},
      confirmedOccupant: undefined,
    });

    await expect(result).resolves.toMatchObject({ success: true });
    expect(update).toHaveBeenCalled();
  });

  it('accepts the empty-bed shape produced by the real client factory', async () => {
    const requestedBed = sanitizeForFirestore({
      ...createEmptyPatient('R1'),
      location: '',
    }) as Record<string, unknown>;
    const { result, update } = await executeClear({
      remoteBed: {},
      confirmedOccupant: {
        clinicalEpisodeId: 'ep-uno',
        rut: '11.111.111-1',
        patientName: 'Paciente Uno',
        admissionDate: '2026-05-13',
        admissionTime: '08:00',
      },
      requestedBed,
    });

    await expect(result).resolves.toMatchObject({ success: true });
    expect(update).toHaveBeenCalled();
  });

  it('allows clearing a parent bed when its associated crib identity is confirmed', async () => {
    const { result, update } = await executeClear({
      remoteBed: {
        clinicalCrib: {
          patientName: 'RN Uno',
          rut: '22.222.222-2',
          clinicalEpisodeId: 'crib-episode',
        },
      },
      confirmedOccupant: {
        clinicalEpisodeId: 'ep-uno',
        rut: '11.111.111-1',
        patientName: 'Paciente Uno',
      },
      confirmedAssociatedCrib: {
        clinicalEpisodeId: 'crib-episode',
        rut: '22.222.222-2',
        patientName: 'RN Uno',
      },
    });

    await expect(result).resolves.toMatchObject({ success: true });
    expect(update).toHaveBeenCalled();
  });

  it('allows confirming a present associated crib before it has occupant identity', async () => {
    const { result, update } = await executeClear({
      remoteBed: {
        clinicalCrib: {
          patientName: '  ',
          rut: ' ',
          clinicalEpisodeId: '   ',
          bedMode: 'Cuna',
        },
      },
      confirmedOccupant: {
        clinicalEpisodeId: 'ep-uno',
        rut: '11.111.111-1',
        patientName: 'Paciente Uno',
      },
      confirmedAssociatedCrib: { presenceOnly: true },
    });

    await expect(result).resolves.toMatchObject({ success: true });
    expect(update).toHaveBeenCalled();
  });

  it('rejects presence-only confirmation for the parent occupant', async () => {
    const { result, set, update } = await executeClear({
      remoteBed: {
        patientName: '',
        rut: '',
        clinicalEpisodeId: '',
      },
      confirmedOccupant: { presenceOnly: true },
      confirmedAssociatedCrib: null,
    });

    await expect(result).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a presence-only confirmation after the crib receives occupant identity', async () => {
    const { result, set, update } = await executeClear({
      remoteBed: {
        clinicalCrib: {
          patientName: 'RN identificado',
          clinicalEpisodeId: 'crib-episode',
        },
      },
      confirmedOccupant: {
        clinicalEpisodeId: 'ep-uno',
        rut: '11.111.111-1',
        patientName: 'Paciente Uno',
      },
      confirmedAssociatedCrib: { presenceOnly: true },
    });

    await expect(result).rejects.toMatchObject({ code: 'aborted' });
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a stale presence-only crib confirmation at the server boundary', async () => {
    const { result, set, update } = await executeClear({
      remoteBed: {
        clinicalCrib: {
          patientName: '',
          rut: '',
          clinicalEpisodeId: '',
          bedMode: 'Cuna',
        },
      },
      confirmedOccupant: {
        clinicalEpisodeId: 'ep-uno',
        rut: '11.111.111-1',
        patientName: 'Paciente Uno',
      },
      confirmedAssociatedCrib: { presenceOnly: true },
      requestVersion: '2026-05-13T07:00:00.000Z',
    });

    await expect(result).rejects.toMatchObject({ code: 'aborted' });
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a legacy parent clear that did not confirm an existing associated crib', async () => {
    const { result, set, update } = await executeClear({
      remoteBed: {
        clinicalCrib: {
          patientName: 'RN Uno',
          clinicalEpisodeId: 'crib-episode',
        },
      },
      confirmedOccupant: {
        clinicalEpisodeId: 'ep-uno',
        rut: '11.111.111-1',
        patientName: 'Paciente Uno',
      },
    });

    await expect(result).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a parent clear when a crib appeared after its absence was confirmed', async () => {
    const { result, set, update } = await executeClear({
      remoteBed: {
        clinicalCrib: {
          patientName: 'RN agregado',
          clinicalEpisodeId: 'new-crib',
        },
      },
      confirmedOccupant: {
        clinicalEpisodeId: 'ep-uno',
        rut: '11.111.111-1',
        patientName: 'Paciente Uno',
      },
      confirmedAssociatedCrib: null,
    });

    await expect(result).rejects.toMatchObject({ code: 'aborted' });
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a parent clear when the associated crib differs from the confirmation', async () => {
    const { result, set, update } = await executeClear({
      remoteBed: {
        clinicalCrib: {
          patientName: 'RN reemplazado',
          clinicalEpisodeId: 'replacement-crib',
        },
      },
      confirmedOccupant: {
        clinicalEpisodeId: 'ep-uno',
        rut: '11.111.111-1',
        patientName: 'Paciente Uno',
      },
      confirmedAssociatedCrib: {
        clinicalEpisodeId: 'confirmed-crib',
        patientName: 'RN confirmado',
      },
    });

    await expect(result).rejects.toMatchObject({ code: 'aborted' });
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a parent clear when the confirmed associated crib was removed', async () => {
    const { result, set, update } = await executeClear({
      remoteBed: {},
      confirmedOccupant: {
        clinicalEpisodeId: 'ep-uno',
        rut: '11.111.111-1',
        patientName: 'Paciente Uno',
      },
      confirmedAssociatedCrib: {
        clinicalEpisodeId: 'crib-episode',
        patientName: 'RN Uno',
      },
    });

    await expect(result).rejects.toMatchObject({ code: 'aborted' });
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
