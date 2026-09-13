import { describe, expect, it, vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type {
  DailyRecord,
  PatientData,
} from '@/features/rayen-import/contracts/rayenDomainContracts';
import { previousCensusContinuityConflicts } from '@/features/rayen-import/domain/previousCensusContinuity';
import { replanRayenStructure } from '@/features/rayen-import/hooks/replanRayenStructure';

// Synthetic identities only. Equal RUNs are intentional: they must not collapse distinct subjects.
const TODAY = '2026-09-02';
const YESTERDAY = '2026-09-01';
const legacyPatient = (overrides: Partial<PatientData> = {}): PatientData => ({
  ...EMPTY_PATIENT,
  bedId: 'H4C1',
  patientName: 'Paciente Identidad Sintetica',
  rut: '11.111.111-1',
  admissionDate: '2026-08-30',
  admissionTime: '10:00',
  ...overrides,
});
const record = (date: string, beds: DailyRecord['beds'] = {}): DailyRecord => ({
  date,
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated: `${date}T15:00:00.000Z`,
});
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
const conflicts = (previous: DailyRecord, current: DailyRecord, diff = emptyDiff()) =>
  previousCensusContinuityConflicts(previous, current, diff);
const expectMissing = (result: ReturnType<typeof conflicts>, patient: PatientData) => {
  expect(result).toEqual([
    expect.objectContaining({
      code: 'previous-census-continuity',
      bedId: null,
      patientName: patient.patientName,
      rut: patient.rut,
    }),
  ]);
};
const nestedDeparture = (
  patient: PatientData,
  deleted = false
): DailyRecord['discharges'][number] => ({
  id: 'synthetic-nested-discharge',
  movementDate: TODAY,
  bedId: patient.bedId,
  bedName: 'Cuna sintética',
  bedType: 'Cuna',
  patientName: patient.patientName,
  rut: patient.rut,
  clinicalEpisodeId: patient.clinicalEpisodeId,
  admissionDate: patient.admissionDate,
  originalData: { ...patient },
  isNested: true,
  diagnosis: 'Diagnóstico sintético',
  time: '11:00',
  status: 'Vivo',
  dischargeType: 'Domicilio (Habitual)',
  ...(deleted ? { deletedAt: `${TODAY}T19:00:00.000Z` } : {}),
});

const replanSetup = (previous: DailyRecord | null) => {
  const getAuthoritativeForDate = vi.fn().mockResolvedValue(previous);
  const getForDate = vi.fn().mockResolvedValue(record(YESTERDAY));
  const dependencies = {
    dailyRecord: { getAuthoritativeForDate, getForDate } as unknown as DailyRecordRepositoryPort,
    isAdmin: false,
    fetchPatientFlowReport: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
    fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
    lookupEgresos: vi.fn().mockResolvedValue([]),
  };
  const evidence = {
    sourceSnapshot: {
      capturedAt: `${TODAY}T14:00:00-06:00`,
      facilityId: 1342,
      encounters: [],
      isComplete: true,
    },
    egresoRows: [],
    reportDate: TODAY,
    isHistoricalDay: false,
  };
  return {
    getAuthoritativeForDate,
    getForDate,
    replan: () => replanRayenStructure(record(TODAY), evidence, dependencies),
  };
};

describe('previous census continuity identity boundaries', () => {
  it.each([false, true])(
    'does not use a legacy mother to explain her vanished crib (same name: %s)',
    sameName => {
      const mother = legacyPatient();
      const crib = legacyPatient({
        patientName: sameName ? mother.patientName : 'Recien Nacido Sintetico',
      });
      const previous = record(YESTERDAY, { H4C1: { ...mother, clinicalCrib: crib } });
      const current = record(TODAY, { H4C1: mother });
      expectMissing(conflicts(previous, current), crib);
    }
  );

  it('keeps both unresolved legacy subjects when mother and crib share RUN, name and admission', () => {
    const mother = legacyPatient();
    const previous = record(YESTERDAY, { H4C1: { ...mother, clinicalCrib: { ...mother } } });
    const result = conflicts(previous, record(TODAY));
    expect(result).toHaveLength(2);
    expect(result.every(entry => entry.code === 'previous-census-continuity')).toBe(true);
  });

  it.each(['principal', 'crib'] as const)(
    'accepts unique strict legacy identity enriched with an exact episode ID today for %s',
    scope => {
      const patient = legacyPatient();
      const enriched = {
        ...patient,
        bedId: 'H4C2',
        clinicalEpisodeId: 'synthetic-enriched-episode',
      };
      const mother = legacyPatient({
        clinicalEpisodeId: 'synthetic-mother',
        patientName: 'Madre Sintetica',
      });
      const previous = record(YESTERDAY, {
        H4C1: scope === 'crib' ? { ...mother, clinicalCrib: patient } : patient,
      });
      const current = record(TODAY, {
        H4C2: scope === 'crib' ? { ...mother, bedId: 'H4C2', clinicalCrib: enriched } : enriched,
      });
      expect(conflicts(previous, current)).toEqual([]);
    }
  );

  it.each([
    ['RUN', { rut: '22.222.222-2' }],
    ['name', { patientName: 'Otra Identidad Sintetica' }],
    ['admission date', { admissionDate: '2026-08-31' }],
    ['admission time', { admissionTime: '10:01' }],
  ] satisfies Array<[string, Partial<PatientData>]>)(
    'rejects legacy enrichment with a different %s',
    (_field, patch) => {
      const patient = legacyPatient();
      const current = record(TODAY, {
        H4C1: { ...patient, clinicalEpisodeId: 'synthetic-enriched-episode', ...patch },
      });
      expectMissing(conflicts(record(YESTERDAY, { H4C1: patient }), current), patient);
    }
  );

  it.each(['rut', 'patientName', 'admissionDate', 'admissionTime'] as const)(
    'does not enrich an incomplete legacy identity missing %s',
    field => {
      const patient = legacyPatient({ [field]: '' });
      // A nameless bed is not an occupied subject; keep the prior subject named for this case.
      const previousPatient = field === 'patientName' ? legacyPatient() : patient;
      const current = record(TODAY, {
        H4C1: { ...patient, clinicalEpisodeId: 'synthetic-enriched-episode' },
      });
      expectMissing(
        conflicts(record(YESTERDAY, { H4C1: previousPatient }), current),
        previousPatient
      );
    }
  );

  it('does not enrich a prior crib using an identically named principal episode', () => {
    const crib = legacyPatient();
    const mother = legacyPatient({ patientName: 'Madre Sintetica', clinicalEpisodeId: 'mother' });
    const previous = record(YESTERDAY, { H4C1: { ...mother, clinicalCrib: crib } });
    const current = record(TODAY, {
      H4C1: mother,
      H4C2: { ...crib, bedId: 'H4C2', clinicalEpisodeId: 'new-principal' },
    });
    expectMissing(conflicts(previous, current), crib);
  });

  it('blocks ambiguous enrichment when two exact current episodes share the strict legacy identity', () => {
    const patient = legacyPatient();
    const current = record(TODAY, {
      H4C1: { ...patient, clinicalEpisodeId: 'candidate-one' },
      H4C2: { ...patient, bedId: 'H4C2', clinicalEpisodeId: 'candidate-two' },
    });
    expectMissing(conflicts(record(YESTERDAY, { H4C1: patient }), current), patient);
  });

  it('blocks enrichment when two prior legacy subjects compete for one exact current episode', () => {
    const patient = legacyPatient();
    const previous = record(YESTERDAY, {
      H4C1: patient,
      H4C2: { ...patient, bedId: 'H4C2' },
    });
    const current = record(TODAY, {
      H4C1: { ...patient, clinicalEpisodeId: 'one-enriched-episode' },
    });
    const result = conflicts(previous, current);
    expect(result).toHaveLength(2);
    expect(result.every(entry => entry.code === 'previous-census-continuity')).toBe(true);
  });

  it('does not let a nested legacy discharge explain an identical principal identity', () => {
    const patient = legacyPatient();
    const previous = record(YESTERDAY, { H4C1: patient });
    const current = record(TODAY);
    current.discharges.push(nestedDeparture(patient));
    expectMissing(conflicts(previous, current), patient);
  });

  it('does not let duplicated evidence for one exact episode create false ambiguity', () => {
    const patient = legacyPatient();
    const enriched = { ...patient, clinicalEpisodeId: 'same-enriched-episode' };
    const diff = emptyDiff();
    diff.updates.push({
      bedId: 'H4C1',
      rut: patient.rut,
      patientName: patient.patientName,
      changes: [],
      patient: enriched,
    });
    expect(
      conflicts(record(YESTERDAY, { H4C1: patient }), record(TODAY, { H4C1: enriched }), diff)
    ).toEqual([]);
  });

  it('never substitutes a different exact episode even with identical legacy demographics', () => {
    const patient = legacyPatient({ clinicalEpisodeId: 'old-episode' });
    expectMissing(
      conflicts(
        record(YESTERDAY, { H4C1: patient }),
        record(TODAY, {
          H4C1: { ...patient, clinicalEpisodeId: 'new-episode' },
        })
      ),
      patient
    );
  });

  it.each(['legacy', 'exact'] as const)(
    'counts an actual nested discharge for the %s crib only',
    identity => {
      const mother = legacyPatient();
      const crib = legacyPatient({
        patientName: 'Recien Nacido Sintetico',
        ...(identity === 'exact' ? { clinicalEpisodeId: 'crib-episode' } : {}),
      });
      const previous = record(YESTERDAY, { H4C1: { ...mother, clinicalCrib: crib } });
      const current = record(TODAY, { H4C1: mother });
      current.discharges.push(nestedDeparture(crib));
      expect(conflicts(previous, current)).toEqual([]);
    }
  );

  it.each(['legacy', 'exact'] as const)(
    'ignores a deleted nested discharge for the %s crib',
    identity => {
      const mother = legacyPatient();
      const crib = legacyPatient({
        patientName: 'Recien Nacido Sintetico',
        ...(identity === 'exact' ? { clinicalEpisodeId: 'crib-episode' } : {}),
      });
      const previous = record(YESTERDAY, { H4C1: { ...mother, clinicalCrib: crib } });
      const current = record(TODAY, { H4C1: mother });
      current.discharges.push(nestedDeparture(crib, true));
      expectMissing(conflicts(previous, current), crib);
    }
  );
});

describe('previous census continuity through structural replan', () => {
  it('preserves all missing episodes, including repeated RUN and name, on every replan', async () => {
    const previous = record(YESTERDAY, {
      H4C1: legacyPatient({ clinicalEpisodeId: 'missing-one' }),
      H4C2: legacyPatient({ bedId: 'H4C2', clinicalEpisodeId: 'missing-two' }),
      H4C3: legacyPatient({
        bedId: 'H4C3',
        patientName: 'Otro Paciente Sintetico',
        rut: '22.222.222-2',
        clinicalEpisodeId: 'missing-three',
      }),
    });
    const before = structuredClone(previous);
    const setup = replanSetup(previous);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const diff = await setup.replan();
      expect(
        diff.conflicts.filter(entry => entry.code === 'previous-census-continuity')
      ).toHaveLength(3);
      expect(diff.summary.conflicts).toBe(diff.conflicts.length);
      expect(diff.discharges).toEqual([]);
      expect(diff.reportEgresos ?? []).toEqual([]);
      expect(diff.previousDayEdits ?? []).toEqual([]);
    }
    expect(previous).toEqual(before);
    expect(setup.getAuthoritativeForDate).toHaveBeenCalledTimes(2);
    expect(setup.getAuthoritativeForDate).toHaveBeenCalledWith(YESTERDAY);
  });

  it('fails closed when the authoritative D-1 record has the wrong date', async () => {
    const setup = replanSetup(record('2026-08-31'));
    await expect(setup.replan()).rejects.toThrow(/fecha/i);
    expect(setup.getAuthoritativeForDate).toHaveBeenCalledWith(YESTERDAY);
    expect(setup.getForDate).not.toHaveBeenCalled();
  });

  it('fails closed on rejected authoritative D-1 reads instead of using an empty cached census', async () => {
    const setup = replanSetup(null);
    const failure = new Error('Synthetic authoritative D-1 read failed');
    setup.getAuthoritativeForDate.mockRejectedValue(failure);
    await expect(setup.replan()).rejects.toBe(failure);
    expect(setup.getAuthoritativeForDate).toHaveBeenCalledWith(YESTERDAY);
    expect(setup.getForDate).not.toHaveBeenCalled();
  });
});
