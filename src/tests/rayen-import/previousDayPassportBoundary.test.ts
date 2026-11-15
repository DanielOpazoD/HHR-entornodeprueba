import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { EMPTY_PATIENT } from '@/constants/patient';
import type {
  AdmissionEntry,
  CensusImportDiff,
  DischargeEntry,
} from '@/features/rayen-import/contracts/censusImportDiff';
import type { RayenCensusSnapshot } from '@/features/rayen-import/contracts/rayenSnapshot';
import { applyCrossDayDiff } from '@/features/rayen-import/domain/applyCrossDayDiff';
import {
  applyHistoricalAdmissions,
  confirmedPreviousDayAdmissionsByDay,
} from '@/features/rayen-import/domain/previousDayAdmissionCorrections';
import {
  computePreviousDayEdits,
  fileCrossDayCorrections,
  verifyPreviousDayAdmissionPlacements,
} from '@/features/rayen-import/domain/previousDayCorrections';
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DischargeData } from '@/types/domain/movements';
import type { PatientData } from '@/types/domain/patient';

vi.mock('@/hooks/controllers/dailyRecordMutationFreshnessController', () => ({
  patchDailyRecordWithCompatibility: vi.fn().mockResolvedValue({}),
}));

// Ana has always held a passport whose digits form Bruno's RUT: two different people.
const ANA_PASSPORT = 'P123456785';
const BRUNO_RUT = '12.345.678-5';
const DAY = '2026-07-25';
const CENSUS_DAY = '2026-07-26';

const emptyDiff = (): CensusImportDiff => ({
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
});

const record = (date: string, extra: Partial<DailyRecord> = {}): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated: 'before',
  ...extra,
});

const portReturning = (read: (day: string) => DailyRecord | null) =>
  ({
    getAuthoritativeForDate: vi.fn(async (day: string) => read(day)),
    getLocalForDateWithMeta: vi.fn(async () => ({
      record: null,
      hasPendingWrites: false,
      hasPendingWritesForDate: false,
      writeState: 'none' as const,
    })),
  }) as unknown as DailyRecordRepositoryPort;

const bruno = (extra: Partial<PatientData> = {}): PatientData => ({
  ...EMPTY_PATIENT,
  bedId: 'H5C1',
  patientName: 'Bruno Otra Persona',
  rut: BRUNO_RUT,
  admissionDate: '2026-07-20',
  admissionTime: '10:00',
  ...extra,
});

const brunoDischarge = (id = 'manual-bruno'): DischargeData =>
  ({
    id,
    bedName: 'H5C1',
    bedId: 'H5C1',
    patientName: 'Bruno Otra Persona',
    rut: BRUNO_RUT,
    time: '18:00',
    status: 'Vivo',
  }) as DischargeData;

const anaEncounter = {
  encounterId: '143200',
  run: ANA_PASSPORT,
  firstGivenName: 'Ana',
  firstFamilyName: 'Pasaporte',
  admissionDatetime: '2026-07-26T03:27:00-06:00',
  room: 'H4',
  bed: 'C1',
};

const anaNightAdmission = (patient: Partial<PatientData> = {}): AdmissionEntry => ({
  bedId: 'H4C1',
  isCma: false,
  patient: {
    ...EMPTY_PATIENT,
    bedId: 'H4C1',
    patientName: 'Ana Pasaporte',
    rut: ANA_PASSPORT,
    clinicalEpisodeId: '143200',
    admissionDate: CENSUS_DAY,
    admissionTime: '03:27',
    pathology: 'Neumonía de Ana',
    ...patient,
  },
  source: {
    ...anaEncounter,
    verifiedBedPlacement: {
      source: 'patient-flow-report',
      bedId: 'H4C1',
      changedAt: '2026-07-26T03:27:00',
    },
  },
});

const anaDischarge = (): DischargeEntry => ({
  bedId: 'H2C1',
  rut: ANA_PASSPORT,
  patientName: 'Ana Pasaporte',
  kind: 'alta',
  status: 'Vivo',
  reason: 'administrative-discharge',
  correctedDay: DAY,
  correctedTime: '20:00',
});

const anaReportEgreso = () => ({
  run: ANA_PASSPORT,
  patientName: 'Ana Pasaporte',
  bedLabel: 'H2C1',
  destino: 'Domicilio',
  fechaEgreso: '25/07/2026 20:00',
  kind: 'alta' as const,
  status: 'Vivo' as const,
  correctedDay: DAY,
  correctedTime: '20:00',
});

const anaPatient = (): PatientData => ({
  ...EMPTY_PATIENT,
  bedId: 'H2C1',
  patientName: 'Ana Pasaporte',
  rut: ANA_PASSPORT,
});

const crossDayContext = { idFactory: () => 'random-id', syncRunId: 'run-1' };

describe('previous-day corrections keep a passport apart from the RUT its digits form', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00Z'));
    vi.mocked(patchDailyRecordWithCompatibility)
      .mockReset()
      .mockResolvedValue({} as never);
  });
  afterEach(() => vi.useRealTimers());

  it('admits the passport holder on the previous night instead of copying her diagnosis to another patient', async () => {
    const diff = { ...emptyDiff(), admissions: [anaNightAdmission()] };
    const previous = record(DAY, { beds: { H5C1: bruno() } });
    const plan = await computePreviousDayEdits(
      portReturning(() => previous),
      diff,
      CENSUS_DAY,
      false
    );
    const subjects =
      confirmedPreviousDayAdmissionsByDay(
        { ...diff, previousDayEdits: plan.edits },
        CENSUS_DAY,
        false,
        () => true
      ).get(DAY) ?? [];

    const corrected = applyHistoricalAdmissions(previous, subjects).record;

    expect(corrected.beds.H4C1?.patientName).toBe('Ana Pasaporte');
    expect(corrected.beds.H5C1?.patientName).toBe('Bruno Otra Persona');
    expect(corrected.beds.H5C1?.pathology).toBe('');
  });

  it("files the passport holder's previous-day discharge although another person's RUT discharge is there", async () => {
    const previous = record(DAY, { discharges: [brunoDischarge()] });

    const plan = await computePreviousDayEdits(
      portReturning(() => previous),
      { ...emptyDiff(), discharges: [anaDischarge()] },
      CENSUS_DAY,
      false
    );

    expect(plan.edits.map(edit => edit.patientNames)).toEqual([['Ana Pasaporte']]);
    expect(plan.recordedDischarges).toBeUndefined();
  });

  it('does not propose an egreso already filed for the passport holder because another person occupies a bed', async () => {
    const anaFiled = {
      ...brunoDischarge('manual-ana'),
      patientName: 'Ana Pasaporte',
      rut: ANA_PASSPORT,
    };
    const previous = record(DAY, { discharges: [anaFiled], beds: { H5C1: bruno() } });

    const plan = await computePreviousDayEdits(
      portReturning(() => previous),
      { ...emptyDiff(), reportEgresos: [anaReportEgreso()] },
      CENSUS_DAY,
      false
    );

    expect(plan.edits).toEqual([]);
    expect(plan.reportEgresos).toEqual([]);
  });

  it("never copies the passport holder's diagnosis onto another person who took the bed before confirmation", async () => {
    // A subject without an episode is identified by its document alone.
    const diff = {
      ...emptyDiff(),
      admissions: [anaNightAdmission({ clinicalEpisodeId: undefined })],
    };
    let admissionConfirmed = false;
    const port = portReturning(day =>
      day !== DAY
        ? null
        : admissionConfirmed
          ? record(DAY, { beds: { H4C1: bruno({ bedId: 'H4C1' }) } })
          : record(DAY)
    );
    vi.mocked(patchDailyRecordWithCompatibility).mockImplementation(async () => {
      admissionConfirmed = true;
      return {} as never;
    });
    const plan = await computePreviousDayEdits(port, diff, CENSUS_DAY, false);

    await expect(
      fileCrossDayCorrections(
        port,
        record(CENSUS_DAY),
        { ...diff, previousDayEdits: plan.edits },
        CENSUS_DAY,
        false,
        () => 'id',
        { syncRunId: 'run-1' }
      )
    ).rejects.toThrow('El paciente del ingreso histórico cambió antes de copiar el diagnóstico.');
    const writtenPaths = vi
      .mocked(patchDailyRecordWithCompatibility)
      .mock.calls.flatMap(call => Object.keys(call[2] as object));
    expect(writtenPaths).not.toContain('beds.H4C1.pathology');
  });

  it("builds the snapshot's night admission from the passport holder, not from another patient with her digits", async () => {
    const current = record(CENSUS_DAY, {
      beds: {
        H5C1: bruno(),
        H4C1: { ...anaNightAdmission().patient, pathology: '' },
      },
    });

    const verified = await verifyPreviousDayAdmissionPlacements(emptyDiff(), CENSUS_DAY, {
      fetchReport: vi.fn().mockResolvedValue({ error: 'unavailable' }),
      currentRecord: current,
      snapshot: {
        capturedAt: '2026-07-26T12:00:00Z',
        encounters: [anaEncounter],
      } as unknown as RayenCensusSnapshot,
    });

    expect(
      verified.previousDayAdmissionCandidates?.map(entry => entry.patient.patientName)
    ).toEqual(['Ana Pasaporte']);
  });

  it("appends the passport holder's movement next to another person's RUT discharge", () => {
    const result = applyCrossDayDiff(
      record(DAY, { discharges: [brunoDischarge()] }),
      [{ entry: anaDischarge(), patient: anaPatient() }],
      crossDayContext
    );

    expect(result.applied).toBe(1);
    expect(result.record.discharges.map(movement => movement.patientName)).toEqual([
      'Bruno Otra Persona',
      'Ana Pasaporte',
    ]);
  });

  it("gives the passport holder's movement its own id, so it never replaces a synced RUT discharge", () => {
    const syncedBruno = brunoDischarge(`rayen-egreso:123456785:${DAY}`);
    const result = applyCrossDayDiff(
      record(DAY, { discharges: [syncedBruno] }),
      [{ entry: anaDischarge(), patient: anaPatient() }],
      crossDayContext
    );

    expect(result.applied).toBe(1);
    const ids = result.record.discharges.map(movement => movement.id);
    expect(new Set(ids).size).toBe(2);
    expect(result.record.discharges[0]).toBe(syncedBruno);
  });

  it("does not file the passport holder's egreso twice on a day corrected with the earlier digit id", () => {
    // Before this change the movement id was built from the passport's digits; on a re-sync the
    // new id differs, so only the stored document keeps the egreso from being appended again.
    const filedEarlier = {
      ...brunoDischarge(`rayen-egreso:123456785:${DAY}`),
      bedId: 'H2C1',
      bedName: 'H2C1',
      patientName: 'Ana Pasaporte',
      rut: ANA_PASSPORT,
    };
    const result = applyCrossDayDiff(
      record(DAY, { discharges: [filedEarlier] }),
      [{ entry: anaDischarge(), patient: anaPatient() }],
      crossDayContext
    );

    expect(result.applied).toBe(0);
    expect(result.record.discharges).toEqual([filedEarlier]);
  });

  it('still recognises the same RUT written in two formats as one patient', () => {
    const result = applyCrossDayDiff(
      record(DAY, { discharges: [brunoDischarge()] }),
      [
        {
          entry: { ...anaDischarge(), rut: '123456785', patientName: 'Bruno Otra Persona' },
          patient: bruno(),
        },
      ],
      crossDayContext
    );

    expect(result.applied).toBe(0);
  });
});
