import { describe, expect, it, vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { EMPTY_PATIENT } from '@/constants/patient';
import type {
  CensusImportDiff,
  ConflictEntry,
} from '@/features/rayen-import/contracts/censusImportDiff';
import type {
  DailyRecord,
  PatientData,
} from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { RayenEncounter } from '@/features/rayen-import/contracts/rayenSnapshot';
import { applyCensusImportDiff } from '@/features/rayen-import/domain/applyCensusImportDiff';
import { replanRayenStructure } from '@/features/rayen-import/hooks/replanRayenStructure';

// Entirely synthetic: the old episode disappeared before today's first sync.
// Neither an empty bulk report nor absence from Ficha proves an administrative egreso.
const TODAY = '2026-09-02';
const YESTERDAY = '2026-09-01';
const BED_ID = 'H4C1';
const OLD_EPISODE = 'continuity-old-episode';
const NEW_EPISODE = 'continuity-new-episode';
const patient: PatientData = {
  ...EMPTY_PATIENT,
  bedId: BED_ID,
  patientName: 'Paciente Continuidad Sintetica',
  rut: '11.111.111-1',
  clinicalEpisodeId: OLD_EPISODE,
  admissionDate: '2026-08-30',
  admissionTime: '10:00',
};

const makeRecord = (date: string, beds: DailyRecord['beds'] = {}): DailyRecord => ({
  date,
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated: `${date}T15:00:00.000Z`,
});

const makeEncounter = (encounterId: string): RayenEncounter => ({
  encounterId,
  run: patient.rut,
  firstGivenName: 'Paciente',
  firstFamilyName: 'Continuidad',
  secondFamilyName: 'Sintetica',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H4',
  bed: 'C2',
  admissionDatetime: `${TODAY}T10:00:00-06:00`,
});

const addRecordedDeparture = (
  record: DailyRecord,
  kind: 'discharge' | 'transfer',
  episodeId = OLD_EPISODE
): void => {
  const movement = {
    id: `recorded-${kind}-${episodeId}`,
    movementDate: record.date,
    admissionDate: patient.admissionDate,
    bedName: BED_ID,
    bedId: BED_ID,
    bedType: 'Cama',
    patientName: patient.patientName,
    rut: patient.rut,
    clinicalEpisodeId: episodeId,
    diagnosis: 'Diagnóstico sintético',
    time: '11:00',
  };
  if (kind === 'discharge') {
    record.discharges.push({ ...movement, status: 'Vivo', dischargeType: 'Domicilio (Habitual)' });
  } else {
    record.transfers.push({ ...movement, evacuationMethod: 'Avión', receivingCenter: 'Otro' });
  }
};

const setup = (
  previous: DailyRecord | null = makeRecord(YESTERDAY, { [BED_ID]: { ...patient } })
) => {
  const getAuthoritativeForDate = vi.fn(async (day: string) =>
    day === YESTERDAY ? previous : null
  );
  // The non-authoritative view is deliberately empty; it cannot replace the D-1 authority read.
  const getForDate = vi.fn().mockResolvedValue(null);
  const repository = {
    getAuthoritativeForDate,
    getForDate,
    getLocalForDateWithMeta: vi.fn().mockResolvedValue({
      record: null,
      hasPendingWrites: false,
      hasPendingWritesForDate: false,
      writeState: 'none',
    }),
  } as unknown as DailyRecordRepositoryPort;
  const dependencies = {
    dailyRecord: repository,
    isAdmin: false,
    fetchPatientFlowReport: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
    fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
    lookupEgresos: vi.fn().mockResolvedValue([]),
  };
  return {
    getAuthoritativeForDate,
    replan: (current = makeRecord(TODAY), encounters: RayenEncounter[] = []) =>
      replanRayenStructure(
        current,
        {
          sourceSnapshot: {
            capturedAt: `${TODAY}T14:00:00-06:00`,
            facilityId: 1342,
            encounters,
            isComplete: true,
          },
          egresoRows: [],
          reportDate: TODAY,
          isHistoricalDay: false,
        },
        dependencies
      ),
  };
};

const expectUnresolvedPreviousPatient = (diff: CensusImportDiff): void => {
  // Use the existing ConflictEntry shape, not a fake admission or a new production contract.
  const identity: Pick<ConflictEntry, 'bedId' | 'rut' | 'patientName'> = {
    // The previous bed may belong to a new occupant today: this cannot be isolated there.
    bedId: null,
    rut: patient.rut,
    patientName: patient.patientName,
  };
  expect(diff.conflicts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ...identity, reason: expect.stringMatching(/\S/) }),
    ])
  );
  expect(diff.summary.conflicts).toBe(diff.conflicts.length);
};

const expectNoInventedDeparture = (diff: CensusImportDiff): void => {
  expect(diff.discharges).toEqual([]);
  expect(diff.reportEgresos ?? []).toEqual([]);
  expect(diff.previousDayEdits ?? []).toEqual([]);
};

describe('Rayen previous census continuity without bulk egreso rows', () => {
  it('always reads authoritative yesterday even when today and Ficha are empty', async () => {
    const { replan, getAuthoritativeForDate } = setup();
    await replan();
    expect(getAuthoritativeForDate).toHaveBeenCalledWith(YESTERDAY);
  });

  it('surfaces the disappeared D-1 patient as an unresolved conflict, never an inferred discharge', async () => {
    const previous = makeRecord(YESTERDAY, { [BED_ID]: { ...patient } });
    const current = makeRecord(TODAY);
    const beforePrevious = structuredClone(previous);
    const beforeCurrent = structuredClone(current);
    const diff = await setup(previous).replan(current);

    expectNoInventedDeparture(diff);
    expect(diff.admissions).toEqual([]);
    expect(current).toEqual(beforeCurrent);
    expect(previous).toEqual(beforePrevious);
    const applied = applyCensusImportDiff(current, diff, {
      idFactory: () => 'synthetic-continuity-movement',
      now: new Date(`${TODAY}T20:00:00Z`),
      syncRunId: 'synthetic-continuity-run',
    });
    expect(applied.record.beds).toEqual({});
    expect(applied.record.discharges).toEqual([]);
    expect(applied.record.transfers).toEqual([]);
    expectUnresolvedPreviousPatient(diff);
  });

  it('treats authoritative yesterday not existing as no prior patient, but still checks it', async () => {
    const { replan, getAuthoritativeForDate } = setup(null);
    const diff = await replan();
    expect(diff.conflicts).toEqual([]);
    expectNoInventedDeparture(diff);
    expect(getAuthoritativeForDate).toHaveBeenCalledWith(YESTERDAY);
  });

  it.each([
    ['yesterday', 'discharge'],
    ['yesterday', 'transfer'],
    ['today', 'discharge'],
    ['today', 'transfer'],
  ] as const)('excludes the exact old episode already recorded as %s %s', async (day, kind) => {
    const previous = makeRecord(YESTERDAY, { [BED_ID]: { ...patient } });
    const current = makeRecord(TODAY);
    addRecordedDeparture(day === 'yesterday' ? previous : current, kind);
    const diff = await setup(previous).replan(current);
    expect(diff.conflicts).toEqual([]);
    expectNoInventedDeparture(diff);
  });

  it.each(['discharge', 'transfer'] as const)(
    'does not let a same-RUN %s for a new episode explain the missing old episode',
    async kind => {
      const current = makeRecord(TODAY);
      addRecordedDeparture(current, kind, NEW_EPISODE);
      const diff = await setup().replan(current);
      expectNoInventedDeparture(diff);
      expectUnresolvedPreviousPatient(diff);
    }
  );

  it('does not let a same-RUN new active episode in both HHR and Ficha explain the old episode', async () => {
    const current = makeRecord(TODAY, {
      H4C2: { ...patient, bedId: 'H4C2', clinicalEpisodeId: NEW_EPISODE, admissionDate: TODAY },
    });
    const diff = await setup().replan(current, [makeEncounter(NEW_EPISODE)]);
    expectNoInventedDeparture(diff);
    expectUnresolvedPreviousPatient(diff);
  });

  it('does not invent a continuity gap for the exact episode still present today in another bed', async () => {
    const current = makeRecord(TODAY, { H4C2: { ...patient, bedId: 'H4C2' } });
    const diff = await setup().replan(current, [makeEncounter(OLD_EPISODE)]);
    expect(diff.conflicts).toEqual([]);
    expectNoInventedDeparture(diff);
  });
});
