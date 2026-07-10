import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  planRayenCensusImport,
  rayenToPatientData,
  type ApplyContext,
  type CensusImportDiff,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const REFERENCE = new Date(2026, 6, 8);
const NOW = new Date(2026, 6, 8, 15, 30, 0);

const makeCtx = (): ApplyContext => {
  let n = 0;
  return { idFactory: () => `id-${++n}`, now: NOW };
};

const makeRecord = (beds: Record<string, PatientData>): DailyRecord => ({
  date: '2026-07-08',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const makeEncounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: 'E1',
  run: '144700554',
  firstGivenName: 'Ana',
  firstFamilyName: 'Perez',
  birthDate: '1980-01-01',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H1',
  bed: 'C2',
  admissionDatetime: '2026-07-08T10:00:00-06:00',
  diagnosis: 'Neumonía',
  ...overrides,
});

const snapshotOf = (encounters: RayenEncounter[]): RayenCensusSnapshot => ({
  capturedAt: '2026-07-08T20:00:00-06:00',
  facilityId: 1342,
  encounters,
});

const seedBed = (encounter: RayenEncounter, bedIdOverride?: string): [string, PatientData] => {
  const { patient, bedId } = rayenToPatientData(encounter, REFERENCE);
  return [bedIdOverride ?? bedId ?? '', patient];
};

const planAndApply = (current: DailyRecord, snapshot: RayenCensusSnapshot) => {
  const { diff } = planRayenCensusImport({ current, snapshot, reference: REFERENCE });
  return applyCensusImportDiff(current, diff, makeCtx());
};

const makeDiff = (over: Partial<CensusImportDiff> = {}): CensusImportDiff => ({
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingNursingDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingNursingDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
  ...over,
});

describe('applyCensusImportDiff', () => {
  it('applies an admission into a free bed', () => {
    const result = planAndApply(makeRecord({}), snapshotOf([makeEncounter()]));
    expect(result.applied.admissions).toBe(1);
    expect(result.record.beds.H1C2?.patientName).toBe('Ana Perez');
    expect(result.skipped).toHaveLength(0);
  });

  it('applies an update without clobbering app-managed fields', () => {
    const [bedId, patient] = seedBed(makeEncounter());
    const stale: PatientData = { ...patient, pathology: 'viejo', handoffNote: 'nota clínica' };
    const result = planAndApply(
      makeRecord({ [bedId]: stale }),
      snapshotOf([makeEncounter({ diagnosis: 'Neumonía' })])
    );
    expect(result.applied.updates).toBe(1);
    expect(result.record.beds[bedId].pathology).toBe('Neumonía');
    expect(result.record.beds[bedId].handoffNote).toBe('nota clínica');
  });

  it('applies a move, freeing the source bed', () => {
    const [, patient] = seedBed(makeEncounter());
    const result = planAndApply(
      makeRecord({ H2C1: { ...patient, bedId: 'H2C1' } }),
      snapshotOf([makeEncounter({ room: 'H1', bed: 'C2' })])
    );
    expect(result.applied.moves).toBe(1);
    expect(result.record.beds.H1C2?.patientName).toBe('Ana Perez');
    expect(result.record.beds.H2C1).toBeUndefined();
  });

  it('keeps a medically-discharged patient in the bed until nursing discharge', () => {
    const [bedId, patient] = seedBed(makeEncounter());
    const result = planAndApply(
      makeRecord({ [bedId]: patient }),
      snapshotOf([makeEncounter({ hasMedicalDischarge: true })])
    );
    // Alta médica does not vacate the bed; the nurse finalizes the discharge in HHR.
    expect(result.record.beds[bedId]?.patientName).toBe('Ana Perez');
    expect(result.record.discharges).toHaveLength(0);
    expect(result.record.cma).toHaveLength(0);
  });

  it('applies a discharge entry to discharges[] and vacates the bed', () => {
    const [bedId, patient] = seedBed(makeEncounter());
    const diff = makeDiff({
      discharges: [
        {
          bedId,
          rut: patient.rut,
          patientName: patient.patientName,
          kind: 'alta',
          status: 'Vivo',
          reason: 'missing-in-rayen',
        },
      ],
    });
    const result = applyCensusImportDiff(makeRecord({ [bedId]: patient }), diff, makeCtx());
    expect(result.record.beds[bedId]).toBeUndefined();
    expect(result.record.discharges).toHaveLength(1);
    expect(result.record.discharges[0]).toMatchObject({
      id: 'id-1',
      status: 'Vivo',
      dischargeType: 'Domicilio (Habitual)',
      time: '15:30',
      bedId,
    });
  });

  it('applies a CMA discharge entry to cma[]', () => {
    const cmaEncounter = makeEncounter({
      encounterId: 'ECMA',
      service: 'Área quirúrgica indiferenciada',
      room: 'CMA R1',
      bed: 'CMAR1',
    });
    const [bedId, patient] = seedBed(cmaEncounter);
    const diff = makeDiff({
      discharges: [
        {
          bedId,
          rut: patient.rut,
          patientName: patient.patientName,
          kind: 'cma',
          status: 'Vivo',
          reason: 'rayen-discharge',
          source: cmaEncounter,
        },
      ],
    });
    const result = applyCensusImportDiff(makeRecord({ [bedId]: patient }), diff, makeCtx());
    expect(result.record.beds[bedId]).toBeUndefined();
    expect(result.record.discharges).toHaveLength(0);
    expect(result.record.cma).toHaveLength(1);
    expect(result.record.cma[0]).toMatchObject({
      id: 'id-1',
      interventionType: 'Cirugía Mayor Ambulatoria',
      dischargeTime: '15:30',
    });
  });

  it('never overwrites an occupied bed (defensive skip)', () => {
    const occupant: PatientData = {
      ...EMPTY_PATIENT,
      bedId: 'H1C2',
      patientName: 'Ocupante',
      rut: '9.999.999-9',
    };
    const diff = makeDiff({
      admissions: [
        {
          bedId: 'H1C2',
          isCma: false,
          patient: { ...EMPTY_PATIENT, bedId: 'H1C2', patientName: 'Nuevo', rut: '1-9' },
          source: makeEncounter({ encounterId: 'NEW' }),
        },
      ],
      summary: {
        admissions: 1,
        updates: 0,
        moves: 0,
        discharges: 0,
        pendingNursingDischarges: 0,
        conflicts: 0,
        unchanged: 0,
      },
    });
    const result = applyCensusImportDiff(makeRecord({ H1C2: occupant }), diff, makeCtx());
    expect(result.applied.admissions).toBe(0);
    expect(result.skipped).toEqual([{ kind: 'admission', bedId: 'H1C2', reason: 'Cama ocupada.' }]);
    expect(result.record.beds.H1C2.patientName).toBe('Ocupante');
  });

  it('logs a never-synced report egreso into discharges[] without touching any bed', () => {
    const occupant: PatientData = {
      ...EMPTY_PATIENT,
      bedId: 'R2',
      patientName: 'Otro Paciente',
      rut: '9.999.999-9',
    };
    const diff = makeDiff({
      reportEgresos: [
        {
          run: '11.044.046-4',
          patientName: 'Lorena Lopez Alvarado',
          bedLabel: 'R2',
          destino: 'Domicilio',
          fechaEgreso: '09-07-2026  19:11',
          kind: 'alta',
          status: 'Vivo',
          edad: '60 año(s)',
          servicio: 'Área Médico Quirúrgica Indiferenciada',
          diagnostico: 'Herida de la pierna',
        },
      ],
    });
    // R2 currently holds a DIFFERENT patient in HHR — it must be left untouched.
    const result = applyCensusImportDiff(makeRecord({ R2: occupant }), diff, makeCtx());
    expect(result.record.beds.R2.patientName).toBe('Otro Paciente');
    expect(result.record.discharges).toHaveLength(1);
    expect(result.record.discharges[0]).toMatchObject({
      patientName: 'Lorena Lopez Alvarado',
      rut: '11.044.046-4',
      diagnosis: 'Herida de la pierna',
      dischargeType: 'Domicilio (Habitual)',
      time: '19:11', // taken from the report, not "now"
      status: 'Vivo',
    });
    expect(result.applied.discharges).toBe(1);
  });

  it('routes a report egreso CMA into cma[]', () => {
    const diff = makeDiff({
      reportEgresos: [
        {
          run: '5-1',
          patientName: 'Paciente Cma',
          bedLabel: 'R1',
          destino: 'Cirugía Mayor Ambulatoria',
          fechaEgreso: '09-07-2026  12:30',
          kind: 'cma',
          status: 'Vivo',
        },
      ],
    });
    const result = applyCensusImportDiff(makeRecord({}), diff, makeCtx());
    expect(result.record.cma).toHaveLength(1);
    expect(result.record.cma[0]).toMatchObject({
      patientName: 'Paciente Cma',
      dischargeTime: '12:30', // report time, not "now"
    });
    expect(result.record.discharges).toHaveLength(0);
    expect(result.record.transfers).toHaveLength(0);
  });

  it('routes a report egreso traslado into transfers[]', () => {
    const diff = makeDiff({
      reportEgresos: [
        {
          run: '2-7',
          patientName: 'Paciente Traslado',
          bedLabel: 'Cama 2',
          destino: 'Traslado a otro hospital',
          fechaEgreso: '09-07-2026  10:00',
          kind: 'traslado',
          status: 'Vivo',
        },
      ],
    });
    const result = applyCensusImportDiff(makeRecord({}), diff, makeCtx());
    expect(result.record.transfers).toHaveLength(1);
    expect(result.record.transfers[0]).toMatchObject({
      patientName: 'Paciente Traslado',
      time: '10:00',
    });
    expect(result.record.discharges).toHaveLength(0);
  });
});
