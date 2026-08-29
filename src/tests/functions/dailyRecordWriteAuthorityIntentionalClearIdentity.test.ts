import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

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
}: {
  remoteBed: Record<string, unknown>;
  confirmedOccupant?: Record<string, unknown>;
}) => {
  const base = makeRecord();
  const remote = {
    ...base,
    dateTimestamp: Date.now(),
    beds: { R1: { ...base.beds.R1, ...remoteBed, bedMode: 'Cama', location: '' } },
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
  const result = functionsApi.patchDailyRecordWithClinicalAuthority.run(
    {
      date: remote.date,
      expectedLastUpdated: remote.lastUpdated,
      mode: 'enforced',
      intentionalBedClear: {
        bedId: 'R1',
        confirmedLastUpdated: remote.lastUpdated,
        confirmedOccupant,
      },
      patch: { 'beds.R1': makeCanonicalEmptyBed() },
    },
    makeContext()
  );
  return { result, set };
};

describe('daily record intentional clear occupant identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects two different episode ids even when their legacy tuple matches', async () => {
    const { result, set } = await executeClear({
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
  });

  it('rejects a one-sided episode id instead of falling back to legacy fields', async () => {
    const { result, set } = await executeClear({
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
  });

  it('rejects a same-name legacy occupant with a different admission time', async () => {
    const { result, set } = await executeClear({
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
  });

  it('allows a name-only legacy occupant at the exact confirmed version', async () => {
    const { result, set } = await executeClear({
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
    expect(set).toHaveBeenCalled();
  });

  it('allows a matching RUT without dates at the exact confirmed version', async () => {
    const { result, set } = await executeClear({
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
    expect(set).toHaveBeenCalled();
  });

  it('keeps exact-version compatibility with an already-loaded legacy client', async () => {
    const { result, set } = await executeClear({ remoteBed: {}, confirmedOccupant: undefined });

    await expect(result).resolves.toMatchObject({ success: true });
    expect(set).toHaveBeenCalled();
  });
});
