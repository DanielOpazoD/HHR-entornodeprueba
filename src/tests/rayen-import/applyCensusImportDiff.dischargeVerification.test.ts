import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  rayenToPatientData,
  type ApplyContext,
  type CensusImportDiff,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const REFERENCE = new Date(2026, 8, 15);
const NOW = new Date(2026, 8, 15, 9, 45, 0);

const makeCtx = (): ApplyContext => {
  let n = 0;
  return {
    idFactory: () => `id-${++n}`,
    now: NOW,
    actor: 'Enfermera Rayen',
    syncRunId: 'sync-run-epicrisis',
  };
};

const makeRecord = (beds: Record<string, PatientData>): DailyRecord => ({
  date: '2026-09-15',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const makeEncounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: '8801',
  run: '144700554',
  firstGivenName: 'Ana',
  firstFamilyName: 'Perez',
  birthDate: '1980-01-01',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H1',
  bed: 'C2',
  admissionDatetime: '2026-09-10T10:00:00-03:00',
  diagnosis: 'Neumonía',
  ...overrides,
});

const seedPatient = (overrides: Partial<RayenEncounter> = {}): PatientData => {
  const { patient } = rayenToPatientData(makeEncounter(overrides), REFERENCE);
  return patient;
};

const makeDiff = (over: Partial<CensusImportDiff> = {}): CensusImportDiff => ({
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
  ...over,
});

const pendingClosure = (
  patient: PatientData,
  bedId: string,
  medicalEpicrisis: 'confirmed' | 'not-detected' | 'unknown',
  nursingEpicrisis: 'confirmed' | 'not-detected' | 'unknown' = 'unknown'
) => ({
  bedId,
  rut: patient.rut,
  patientName: patient.patientName,
  signal: 'clinical-closure' as const,
  encounterId: '8801',
  verification: {
    medicalEpicrisis,
    nursingEpicrisis,
    hospitalDischarge: 'unknown' as const,
  },
  source: makeEncounter({
    hasMedicalDischarge: medicalEpicrisis === 'confirmed',
    ...(medicalEpicrisis === 'confirmed' ? { dischargeDatetime: '2026-09-15T08:30:00-03:00' } : {}),
  }),
});

const withConfirmedVerification = (patient: PatientData): PatientData => ({
  ...patient,
  dischargeVerification: {
    medicalEpicrisis: 'confirmed',
    nursingEpicrisis: 'unknown',
    encounterId: '8801',
    registeredAt: '2026-09-14T08:00:00.000Z',
  },
});

describe('applyCensusImportDiff · cierres clínicos verificados en Eloísa', () => {
  it('persists the verified medical discharge of a bed that is still occupied', () => {
    const patient = seedPatient();
    const record = makeRecord({ H1C2: patient });

    const result = applyCensusImportDiff(
      record,
      makeDiff({ pendingAdministrativeDischarges: [pendingClosure(patient, 'H1C2', 'confirmed')] }),
      makeCtx()
    );

    expect(result.record.beds.H1C2.dischargeVerification).toEqual({
      medicalEpicrisis: 'confirmed',
      nursingEpicrisis: 'unknown',
      encounterId: '8801',
      registeredAt: '2026-09-15T08:30:00-03:00',
    });
    // La cama sigue ocupada: la verificación no egresa al paciente por sí sola.
    expect(result.record.beds.H1C2.patientName).toBe(patient.patientName);
  });

  it('persists the nursing discharge even when the medical one is still missing', () => {
    const patient = seedPatient();
    const record = makeRecord({ H1C2: patient });

    const result = applyCensusImportDiff(
      record,
      makeDiff({
        pendingAdministrativeDischarges: [
          pendingClosure(patient, 'H1C2', 'not-detected', 'confirmed'),
        ],
      }),
      makeCtx()
    );

    expect(result.record.beds.H1C2.dischargeVerification).toEqual({
      medicalEpicrisis: 'not-detected',
      nursingEpicrisis: 'confirmed',
      encounterId: '8801',
    });
  });

  it('does not write a verification while Eloísa has not registered the medical discharge', () => {
    const patient = seedPatient();
    const record = makeRecord({ H1C2: patient });

    const result = applyCensusImportDiff(
      record,
      makeDiff({
        pendingAdministrativeDischarges: [pendingClosure(patient, 'H1C2', 'not-detected')],
      }),
      makeCtx()
    );

    expect(result.record.beds.H1C2.dischargeVerification).toBeUndefined();
  });

  it('merges the medical and nursing discharge when they arrive as separate observations', () => {
    const patient = seedPatient();
    const record = makeRecord({ H1C2: patient });

    const result = applyCensusImportDiff(
      record,
      makeDiff({
        pendingAdministrativeDischarges: [
          pendingClosure(patient, 'H1C2', 'confirmed', 'unknown'),
          pendingClosure(patient, 'H1C2', 'unknown', 'confirmed'),
        ],
      }),
      makeCtx()
    );

    expect(result.record.beds.H1C2.dischargeVerification).toEqual({
      medicalEpicrisis: 'confirmed',
      nursingEpicrisis: 'confirmed',
      encounterId: '8801',
      registeredAt: '2026-09-15T08:30:00-03:00',
    });
  });

  it('preserves a previous verification when the capture observes no closure at all', () => {
    const patient = seedPatient();
    const record = makeRecord({ H1C2: withConfirmedVerification(patient) });

    const result = applyCensusImportDiff(record, makeDiff(), makeCtx());

    expect(result.record.beds.H1C2.dischargeVerification).toEqual(
      record.beds.H1C2.dischargeVerification
    );
  });

  it('preserves a previous verification while the closure state stays unknown', () => {
    const patient = seedPatient();
    const record = makeRecord({ H1C2: withConfirmedVerification(patient) });

    const result = applyCensusImportDiff(
      record,
      makeDiff({ pendingAdministrativeDischarges: [pendingClosure(patient, 'H1C2', 'unknown')] }),
      makeCtx()
    );

    expect(result.record.beds.H1C2.dischargeVerification).toEqual(
      record.beds.H1C2.dischargeVerification
    );
  });

  it('clears a previous verification when Eloísa explicitly reports no discharge', () => {
    const patient = seedPatient();
    const record = makeRecord({ H1C2: withConfirmedVerification(patient) });

    const result = applyCensusImportDiff(
      record,
      makeDiff({
        pendingAdministrativeDischarges: [pendingClosure(patient, 'H1C2', 'not-detected')],
      }),
      makeCtx()
    );

    expect(result.record.beds.H1C2.dischargeVerification).toBeUndefined();
  });

  it('does not attach another patient verification to the bed occupant', () => {
    const patient = seedPatient();
    const record = makeRecord({ H1C2: patient });
    const foreignClosure = {
      ...pendingClosure(patient, 'H1C2', 'confirmed'),
      rut: '99999999-9',
    };

    const result = applyCensusImportDiff(
      record,
      makeDiff({ pendingAdministrativeDischarges: [foreignClosure] }),
      makeCtx()
    );

    expect(result.record.beds.H1C2.dischargeVerification).toBeUndefined();
  });

  it('preserves the occupant verification when the closure belongs to a previous patient', () => {
    const patient = seedPatient();
    const record = makeRecord({ H1C2: withConfirmedVerification(patient) });
    const foreignClosure = {
      ...pendingClosure(patient, 'H1C2', 'confirmed'),
      rut: '99999999-9',
    };

    const result = applyCensusImportDiff(
      record,
      makeDiff({ pendingAdministrativeDischarges: [foreignClosure] }),
      makeCtx()
    );

    expect(result.record.beds.H1C2.dischargeVerification).toEqual(
      record.beds.H1C2.dischargeVerification
    );
  });

  it('matches the occupant by Rayen episode when the closure has no RUN', () => {
    const patient = seedPatient();
    const record = makeRecord({ H1C2: patient });
    const closureWithoutRun = {
      ...pendingClosure(patient, 'H1C2', 'confirmed'),
      rut: '',
    };

    const result = applyCensusImportDiff(
      record,
      makeDiff({ pendingAdministrativeDischarges: [closureWithoutRun] }),
      makeCtx()
    );

    expect(result.record.beds.H1C2.dischargeVerification?.medicalEpicrisis).toBe('confirmed');
  });

  it('ignores an identity-less closure that cannot prove the episode', () => {
    const patient = seedPatient();
    const record = makeRecord({ H1C2: patient });
    const anonymousClosure = {
      ...pendingClosure(patient, 'H1C2', 'confirmed'),
      rut: '',
      encounterId: '9999',
      source: undefined,
    };

    const result = applyCensusImportDiff(
      record,
      makeDiff({ pendingAdministrativeDischarges: [anonymousClosure] }),
      makeCtx()
    );

    expect(result.record.beds.H1C2.dischargeVerification).toBeUndefined();
  });
});
