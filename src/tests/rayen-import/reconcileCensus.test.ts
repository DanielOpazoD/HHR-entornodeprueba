import { describe, expect, it } from 'vitest';
import {
  reconcileCensus,
  rayenToPatientData,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const REFERENCE = new Date(2026, 6, 8);

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

/** Seed a current bed from the same mapping the reconciler uses (so it starts "unchanged"). */
const seedBed = (encounter: RayenEncounter, bedIdOverride?: string): [string, PatientData] => {
  const { patient, bedId } = rayenToPatientData(encounter, REFERENCE);
  const key = bedIdOverride ?? bedId ?? '';
  return [key, patient];
};

describe('reconcileCensus', () => {
  it('creates an admission for a Rayen patient absent from the census', () => {
    const diff = reconcileCensus(makeRecord({}), snapshotOf([makeEncounter()]), {
      reference: REFERENCE,
    });
    expect(diff.summary).toMatchObject({ admissions: 1, updates: 0, moves: 0, discharges: 0 });
    expect(diff.admissions[0].bedId).toBe('H1C2');
    expect(diff.admissions[0].patient.patientName).toBe('Ana Perez');
  });

  it('reports no change when the census already matches Rayen', () => {
    const [bedId, patient] = seedBed(makeEncounter());
    const diff = reconcileCensus(makeRecord({ [bedId]: patient }), snapshotOf([makeEncounter()]), {
      reference: REFERENCE,
    });
    expect(diff.summary.unchanged).toBe(1);
    expect(diff.updates).toHaveLength(0);
  });

  it('detects an update when a Rayen-sourced field changed', () => {
    const [bedId, patient] = seedBed(makeEncounter());
    const stale = { ...patient, pathology: 'Diagnóstico viejo' };
    const diff = reconcileCensus(
      makeRecord({ [bedId]: stale }),
      snapshotOf([makeEncounter({ diagnosis: 'Neumonía' })]),
      { reference: REFERENCE }
    );
    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0].changes.map(c => c.field)).toContain('pathology');
  });

  it('detects a move when the Rayen bed differs from the census bed', () => {
    // Same episode currently in H2C1, Rayen now places it in H1C2.
    const [, patient] = seedBed(makeEncounter());
    const diff = reconcileCensus(
      makeRecord({ H2C1: { ...patient, bedId: 'H2C1' } }),
      snapshotOf([makeEncounter({ room: 'H1', bed: 'C2' })]),
      { reference: REFERENCE }
    );
    expect(diff.moves).toHaveLength(1);
    expect(diff.moves[0]).toMatchObject({ fromBedId: 'H2C1', toBedId: 'H1C2' });
  });

  it('creates a discharge for a patient discharged in Rayen', () => {
    const [bedId, patient] = seedBed(makeEncounter());
    const diff = reconcileCensus(
      makeRecord({ [bedId]: patient }),
      snapshotOf([makeEncounter({ hasMedicalDischarge: true })]),
      { reference: REFERENCE }
    );
    expect(diff.discharges).toHaveLength(1);
    expect(diff.discharges[0]).toMatchObject({ reason: 'rayen-discharge', kind: 'alta' });
  });

  it('translates a CMA-service discharge into a CMA discharge kind', () => {
    const cmaEncounter = makeEncounter({
      encounterId: 'ECMA',
      service: 'Área quirúrgica indiferenciada',
      room: 'CMA R1',
      bed: 'CMAR1',
    });
    const [bedId, patient] = seedBed(cmaEncounter); // bedId === 'R1'
    const diff = reconcileCensus(
      makeRecord({ [bedId]: patient }),
      snapshotOf([{ ...cmaEncounter, hasMedicalDischarge: true }]),
      { reference: REFERENCE }
    );
    expect(diff.discharges).toHaveLength(1);
    expect(diff.discharges[0]).toMatchObject({ kind: 'cma', bedId: 'R1' });
  });

  it('flags a census patient absent from the snapshot as missing-in-rayen', () => {
    const [bedId, patient] = seedBed(makeEncounter());
    const diff = reconcileCensus(makeRecord({ [bedId]: patient }), snapshotOf([]), {
      reference: REFERENCE,
    });
    expect(diff.discharges).toHaveLength(1);
    expect(diff.discharges[0].reason).toBe('missing-in-rayen');
  });

  it('reports a conflict when a new Rayen patient targets an occupied bed', () => {
    const occupant: PatientData = {
      ...EMPTY_PATIENT,
      bedId: 'H1C2',
      patientName: 'Otro Paciente',
      rut: '9.999.999-9',
      clinicalEpisodeId: 'OTHER',
    };
    const incoming = makeEncounter({ encounterId: 'NEW', run: '111111111' });
    const diff = reconcileCensus(makeRecord({ H1C2: occupant }), snapshotOf([incoming]), {
      reference: REFERENCE,
    });
    expect(diff.conflicts).toHaveLength(1);
    expect(diff.conflicts[0].bedId).toBe('H1C2');
    expect(diff.admissions).toHaveLength(0);
  });

  it('reports a conflict when the Rayen bed cannot be mapped', () => {
    const diff = reconcileCensus(
      makeRecord({}),
      snapshotOf([makeEncounter({ room: 'ZZ', bed: 'QQ' })]),
      { reference: REFERENCE }
    );
    expect(diff.conflicts).toHaveLength(1);
    expect(diff.conflicts[0].bedId).toBeNull();
  });
});
