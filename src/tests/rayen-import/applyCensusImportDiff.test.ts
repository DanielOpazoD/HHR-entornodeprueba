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

  it('applies a chained move (A→B while B→C) without losing either patient', () => {
    // Carina H6C2→H1C2 and Teresa H1C2→H1C1: H1C2 is both a target and a source. Sources are
    // captured from the ORIGINAL record before any placement, so the chain resolves cleanly.
    const [, base] = seedBed(makeEncounter());
    const teresa = { ...base, patientName: 'Teresa', rut: '1-1', bedId: 'H1C2' };
    const carina = { ...base, patientName: 'Carina', rut: '2-2', bedId: 'H6C2' };
    const diff = makeDiff({
      moves: [
        {
          fromBedId: 'H6C2',
          toBedId: 'H1C2',
          rut: '2-2',
          patientName: 'Carina',
          source: makeEncounter(),
        },
        {
          fromBedId: 'H1C2',
          toBedId: 'H1C1',
          rut: '1-1',
          patientName: 'Teresa',
          source: makeEncounter(),
        },
      ],
      summary: { ...makeDiff().summary, moves: 2 },
    });
    const result = applyCensusImportDiff(
      makeRecord({ H1C2: teresa, H6C2: carina }),
      diff,
      makeCtx()
    );
    expect(result.applied.moves).toBe(2);
    expect(result.record.beds.H1C2?.patientName).toBe('Carina');
    expect(result.record.beds.H1C1?.patientName).toBe('Teresa');
    expect(result.record.beds.H6C2).toBeUndefined();
  });

  it('keeps a medically-discharged patient in bed until administrative discharge', () => {
    const [bedId, patient] = seedBed(makeEncounter());
    const result = planAndApply(
      makeRecord({ [bedId]: patient }),
      snapshotOf([makeEncounter({ hasMedicalDischarge: true })])
    );
    // Ficha Médico does not vacate the bed; Gestión de Camas finalizes the discharge.
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
          reason: 'administrative-discharge',
          correctedTime: '18:20',
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
      time: '18:20',
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
          reason: 'administrative-discharge',
          source: cmaEncounter,
          correctedTime: '17:23',
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
      dischargeTime: '17:23',
    });
  });

  it('uses the statistical egreso hour for a transfer of an occupied patient', () => {
    const [bedId, patient] = seedBed(makeEncounter());
    const diff = makeDiff({
      discharges: [
        {
          bedId,
          rut: patient.rut,
          patientName: patient.patientName,
          kind: 'traslado',
          status: 'Vivo',
          reason: 'administrative-discharge',
          correctedTime: '19:53',
        },
      ],
    });

    const result = applyCensusImportDiff(makeRecord({ [bedId]: patient }), diff, makeCtx());
    expect(result.record.transfers[0]?.time).toBe('19:53');
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
        pendingAdministrativeDischarges: 0,
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
      time: '19:11', // official statistical time from the report, not the sync execution time
      status: 'Vivo',
    });
    expect(result.applied.discharges).toBe(1);
  });

  it('vacates the bed but skips the movement when the egreso belongs to an earlier island day', () => {
    // Haggen was in a bed (carried over) but the official report says he left on 07-07, before this
    // 07-08 census. The bed is freed here; the discharge record is filed on 07-07 (cross-day writer).
    const occupant = {
      ...EMPTY_PATIENT,
      patientName: 'Haggen',
      rut: '19.338.541-9',
    } as PatientData;
    const diff = makeDiff({
      discharges: [
        {
          bedId: 'NEO1',
          rut: '19.338.541-9',
          patientName: 'Haggen',
          kind: 'alta',
          status: 'Vivo',
          reason: 'administrative-discharge',
          correctedDay: '2026-07-07',
          correctedTime: '20:54',
        },
      ],
    });
    const result = applyCensusImportDiff(makeRecord({ NEO1: occupant }), diff, makeCtx());
    expect(result.record.beds.NEO1).toBeUndefined(); // bed freed on today
    expect(result.record.discharges).toHaveLength(0); // NOT filed on today (belongs to 07-07)
    expect(result.applied.discharges).toBe(1);
  });

  it('skips a report egreso whose corrected island day is not this census day', () => {
    // Fetched for [D, D+1], the report also carries rows of a different island day — they must NOT be
    // filed today (earlier → cross-day writer; later → a future sync).
    const diff = makeDiff({
      reportEgresos: [
        {
          run: '7-2',
          patientName: 'Otro Dia',
          bedLabel: 'R1',
          destino: 'Domicilio',
          fechaEgreso: '09-07-2026  08:00',
          kind: 'alta',
          status: 'Vivo',
          correctedDay: '2026-07-09', // record.date is 2026-07-08 → different day → skip
          correctedTime: '06:00',
        },
      ],
    });
    const result = applyCensusImportDiff(makeRecord({}), diff, makeCtx());
    expect(result.record.discharges).toHaveLength(0);
    expect(result.record.transfers).toHaveLength(0);
    expect(result.record.cma).toHaveLength(0);
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
      dischargeTime: '12:30', // official statistical time from the report
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
      time: '10:00', // official statistical time from the report
    });
    expect(result.record.discharges).toHaveLength(0);
  });
});
