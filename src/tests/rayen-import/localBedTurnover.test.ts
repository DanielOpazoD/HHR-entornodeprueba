import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  applyEgresoReport,
  rayenToPatientData,
  reconcileCensus,
  type AdmissionEntry,
  type ConflictEntry,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const REFERENCE = new Date(2026, 6, 24);
const encounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: 'old-episode',
  run: '111111111',
  firstGivenName: 'Paciente',
  firstFamilyName: 'Anterior',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'Neo 1',
  bed: 'Neo1',
  admissionDatetime: '2026-07-23T13:21:41-06:00',
  ...overrides,
});

const currentRecord = (): DailyRecord => ({
  date: '2026-07-24',
  beds: { NEO1: { ...rayenToPatientData(encounter(), REFERENCE).patient, bedId: 'NEO1' } },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const newEncounter = encounter({
  encounterId: 'new-episode',
  run: '222222222',
  firstFamilyName: 'Nuevo',
  admissionDatetime: '2026-07-24T08:00:00-06:00',
});

const snapshot = (): RayenCensusSnapshot => ({
  capturedAt: '2026-07-24T12:30:00-06:00',
  facilityId: 1342,
  isComplete: true,
  encounters: [newEncounter, encounter({ hasMedicalDischarge: true })],
});

const blockedAdmission = (source = newEncounter): AdmissionEntry => ({
  bedId: 'NEO1',
  patient: { ...rayenToPatientData(source, REFERENCE).patient, bedId: 'NEO1' },
  isCma: false,
  source,
});

const conflict = (admission = blockedAdmission()): ConflictEntry => ({
  bedId: 'NEO1',
  rut: admission.patient.rut,
  patientName: admission.patient.patientName,
  code: 'occupied-local-bed',
  blockedAdmission: admission,
  reason: 'ocupada',
  source: admission.source,
});

const unverifiedEgresoRow = (overrides: Record<string, unknown> = {}) => ({
  run: '111111111',
  encounterId: undefined,
  patientName: 'Paciente Anterior',
  bedLabel: 'Neo 1',
  servicio: 'Área Médico Quirúrgica',
  edad: '',
  destino: 'Domicilio',
  motivo: 'Alta hospitalaria',
  fechaEgreso: '24-07-2026 10:00',
  exactEpisodeVerification: 'unverified' as const,
  ...overrides,
});

describe('local sequential bed turnover', () => {
  it('applies the locally identified discharge before the distinct same-bed admission', () => {
    const current = currentRecord();
    const initialDiff = reconcileCensus(current, snapshot(), { reference: REFERENCE });
    const enriched = applyEgresoReport(initialDiff, [unverifiedEgresoRow()], current);

    expect(enriched.summary).toMatchObject({ admissions: 1, discharges: 1, conflicts: 0 });
    expect(enriched.discharges).toEqual([
      expect.objectContaining({
        bedId: 'NEO1',
        encounterId: 'old-episode',
        expectedOccupant: expect.objectContaining({
          clinicalEpisodeId: 'old-episode',
          rut: '11.111.111-1',
        }),
      }),
    ]);

    const applied = applyCensusImportDiff(current, enriched, {
      idFactory: () => 'movement-id',
      now: REFERENCE,
      syncRunId: 'sync-run',
    });
    expect(applied.skipped).toHaveLength(0);
    expect(applied.applied).toMatchObject({ admissions: 1, discharges: 1 });
    expect(applied.record.beds.NEO1.clinicalEpisodeId).toBe('new-episode');
  });

  it('stays blocked without an exact departure signal for the local episode', () => {
    const current = currentRecord();
    const initialDiff = reconcileCensus(current, snapshot(), { reference: REFERENCE });
    const enriched = applyEgresoReport(
      { ...initialDiff, pendingAdministrativeDischarges: [] },
      [unverifiedEgresoRow()],
      current
    );

    expect(enriched.admissions).toHaveLength(0);
    expect(enriched.discharges).toHaveLength(0);
    expect(enriched.conflicts).toHaveLength(2);
  });

  it.each([
    ['another bed', { bedLabel: 'H2C2' }],
    ['a discharge before the active admission', { fechaEgreso: '22-07-2026 10:00' }],
  ])('stays blocked when the report has %s', (_case, overrides) => {
    const current = currentRecord();
    const initialDiff = reconcileCensus(current, snapshot(), { reference: REFERENCE });
    const enriched = applyEgresoReport(initialDiff, [unverifiedEgresoRow(overrides)], current);

    expect(enriched.admissions).toHaveLength(0);
    expect(enriched.discharges).toHaveLength(0);
  });

  it('stays blocked when duplicate unverified rows could identify more than one discharge', () => {
    const current = currentRecord();
    const initialDiff = reconcileCensus(current, snapshot(), { reference: REFERENCE });
    const enriched = applyEgresoReport(
      initialDiff,
      [unverifiedEgresoRow(), unverifiedEgresoRow({ fechaEgreso: '24-07-2026 10:05' })],
      current
    );

    expect(enriched.admissions).toHaveLength(0);
    expect(enriched.discharges).toHaveLength(0);
  });

  it('requires the independent signal to identify the exact stored episode', () => {
    const current = currentRecord();
    const initialDiff = reconcileCensus(current, snapshot(), { reference: REFERENCE });
    const mismatchedSignal = {
      ...initialDiff,
      pendingAdministrativeDischarges: initialDiff.pendingAdministrativeDischarges.map(entry => ({
        ...entry,
        encounterId: 'another-episode',
        source: entry.source ? { ...entry.source, encounterId: 'another-episode' } : entry.source,
      })),
    };
    const enriched = applyEgresoReport(mismatchedSignal, [unverifiedEgresoRow()], current);

    expect(enriched.admissions).toHaveLength(0);
    expect(enriched.discharges).toHaveLength(0);
  });

  it('rejects an unverified report row that identifies another episode', () => {
    const current = currentRecord();
    const initialDiff = reconcileCensus(current, snapshot(), { reference: REFERENCE });
    const enriched = applyEgresoReport(
      initialDiff,
      [unverifiedEgresoRow({ encounterId: 'another-episode' })],
      current
    );

    expect(enriched.admissions).toHaveLength(0);
    expect(enriched.discharges).toHaveLength(0);
  });

  it('stays blocked while an attached clinical crib is occupied', () => {
    const current = currentRecord();
    current.beds.NEO1.clinicalCrib = {
      ...rayenToPatientData(
        encounter({ encounterId: 'crib-episode', run: '333333333', firstFamilyName: 'RN' }),
        REFERENCE
      ).patient,
      bedId: 'NEO1',
      bedMode: 'Cuna',
    };
    const initialDiff = reconcileCensus(current, snapshot(), { reference: REFERENCE });
    const enriched = applyEgresoReport(initialDiff, [unverifiedEgresoRow()], current);

    expect(enriched.admissions).toHaveLength(0);
    expect(enriched.discharges).toHaveLength(0);
  });

  it('stays blocked when two different admissions claim the released bed', () => {
    const current = currentRecord();
    const initialDiff = reconcileCensus(current, snapshot(), { reference: REFERENCE });
    const secondIncoming = encounter({
      encounterId: 'second-incoming-episode',
      run: '333333333',
      firstFamilyName: 'Segundo',
    });
    const ambiguousDiff = {
      ...initialDiff,
      conflicts: [...initialDiff.conflicts, conflict(blockedAdmission(secondIncoming))],
    };
    const enriched = applyEgresoReport(ambiguousDiff, [unverifiedEgresoRow()], current);

    expect(enriched.admissions).toHaveLength(0);
    expect(enriched.discharges).toHaveLength(0);
  });

  it('counts an unidentifiable second claimant as ambiguity', () => {
    const current = currentRecord();
    const initialDiff = reconcileCensus(current, snapshot(), { reference: REFERENCE });
    const unidentified = encounter({
      encounterId: 'unidentified-episode',
      run: '',
      firstFamilyName: 'Sin RUN',
    });
    const ambiguousDiff = {
      ...initialDiff,
      conflicts: [...initialDiff.conflicts, conflict(blockedAdmission(unidentified))],
    };
    const enriched = applyEgresoReport(ambiguousDiff, [unverifiedEgresoRow()], current);

    expect(enriched.admissions).toHaveLength(0);
    expect(enriched.discharges).toHaveLength(0);
  });

  it('does not clear a bed whose occupant changed after preview', () => {
    const current = currentRecord();
    const initialDiff = reconcileCensus(current, snapshot(), { reference: REFERENCE });
    const enriched = applyEgresoReport(initialDiff, [unverifiedEgresoRow()], current);
    const concurrent = currentRecord();
    concurrent.beds.NEO1 = {
      ...rayenToPatientData(
        encounter({ encounterId: 'concurrent-episode', run: '333333333', firstFamilyName: 'Concurrente' }),
        REFERENCE
      ).patient,
      bedId: 'NEO1',
    };

    const applied = applyCensusImportDiff(concurrent, enriched, {
      idFactory: () => 'movement-id',
      now: REFERENCE,
      syncRunId: 'sync-run',
    });

    expect(applied.applied).toMatchObject({ admissions: 0, discharges: 0 });
    expect(applied.skipped.length).toBeGreaterThan(0);
    expect(applied.record.beds.NEO1.clinicalEpisodeId).toBe('concurrent-episode');
  });
});
