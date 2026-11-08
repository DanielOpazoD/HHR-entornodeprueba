import { describe, expect, it, vi } from 'vitest';
import {
  applyCensusImportDiff,
  applyEgresoReport,
  reconcileCensus,
  rayenToPatientData,
  type RayenEncounter,
  type RayenCensusSnapshot,
} from '@/features/rayen-import';
import { startCudyrSyncCapture } from '@/features/rayen-import/domain/startCudyrSyncCapture';
import type { ClinicalFillDeps } from '@/features/rayen-import/contracts/clinicalFillContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { buildMovementsSummaryTables } from '@/services/pdf/handoffPdfMovementsSummarySection';
import { newbornOwnRut } from '@/features/rayen-import/domain/clinicalCribMaternalAssociation';
import type { PatientData } from '@/types/domain/patient';

const now = new Date('2026-11-07T12:00:00-05:00');
const mother = (): RayenEncounter => ({
  encounterId: 'MOTHER',
  run: '144700554',
  firstGivenName: 'Ana',
  firstFamilyName: 'Perez',
  birthDate: '1990-01-01',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H5',
  bed: 'C1',
  admissionDatetime: '2026-11-05T10:00:00-05:00',
  diagnosis: 'Puerperio',
});
const newborn = (run = '7906953'): RayenEncounter => ({
  ...mother(),
  encounterId: 'NEWBORN',
  run,
  firstGivenName: 'RN de Ana',
  birthDate: '2026-11-07',
  room: 'Cunas',
  bed: 'CH5C1',
  clinicalCribParentBedId: 'H5C1',
  admissionDatetime: '2026-11-07T00:03:00-05:00',
  diagnosis: 'Recién nacido',
});
const independent = (): RayenEncounter => ({
  ...newborn(),
  room: 'Neo 1',
  bed: 'Neo1',
  clinicalCribParentBedId: undefined,
});
const seed = (source: RayenEncounter) => rayenToPatientData(source, now).patient;
const record = (beds: Record<string, PatientData>, date = '2026-11-07'): DailyRecord => ({
  date,
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});
const snapshot = (encounters: RayenEncounter[]): RayenCensusSnapshot => ({
  encounters,
  capturedAt: now.toISOString(),
  facilityId: 1342,
});
const sync = (current: DailyRecord, sources: RayenEncounter[], reference = now) => {
  const diff = reconcileCensus(current, snapshot(sources), { reference });
  const result = applyCensusImportDiff(current, diff, {
    now: reference,
    syncRunId: 'newborn-folio',
    idFactory: () => 'id',
  });
  return { diff, ...result };
};
const recover = async (current: DailyRecord) => {
  const spy = vi.fn(async (..._args: unknown[]) => []);
  const { archive } = startCudyrSyncCapture({
    record: current,
    censusDate: current.date,
    captureEpisodes: ['NEWBORN'],
    needsRead: true,
    deps: {
      fetchCudyrCategories: async () => ({
        items: [],
        source: 'gestion_camas',
        historyAvailable: true,
        observedEpisodeIds: [],
      }),
      archiveCudyrCapture: async () => 'persisted',
      recoverCudyrPlacements: spy,
      now: () => now,
      createId: () => 'capture',
    } as unknown as ClinicalFillDeps,
    trackRequest: operation => operation(),
    recordTimeout: vi.fn(),
  });
  await archive;
  return spy;
};

describe('a newborn folio leaves every record the sync keeps', () => {
  it('nested folio cleanup actually sends maternal RUN to CUDYR', async () => {
    const current = record({ H5C1: { ...seed(mother()), clinicalCrib: seed(newborn()) } });
    const saved = sync(current, [mother(), newborn()]);
    expect(saved.diff.conflicts).toEqual([]);
    expect(saved.record.beds.H5C1.clinicalCrib?.rut).toBe('');
    expect((await recover(saved.record)).mock.calls[0]).toEqual([
      'NEWBORN',
      '144700554',
      now.toISOString(),
      'maternal',
      '144700554',
    ]);
  });
  it('independent same-bed active folio cleanup sends maternal RUN', async () => {
    const child = independent();
    const current = record({ NEO1: { ...seed(child), neonatalMaternalRut: seed(mother()).rut } });
    const saved = sync(current, [child]);
    expect(saved.record.beds.NEO1.rut).toBe('');
    expect((await recover(saved.record)).mock.calls[0]?.[1]).toBe('144700554');
  });
  it('independent moved newborn must drop stored folio', async () => {
    const child = independent();
    const moved = { ...child, room: 'Neo 2', bed: 'Neo2' };
    const current = record({ NEO1: { ...seed(child), neonatalMaternalRut: seed(mother()).rut } });
    const saved = sync(current, [moved]);
    expect(saved.diff.conflicts).toEqual([]);
    expect(saved.applied.moves).toBe(1);
    expect((await recover(saved.record)).mock.calls[0]?.[1]).toBe('144700554');
    expect(saved.record.beds.NEO2.rut).toBe('');
  });
  it('independent clinically closed newborn must drop stored folio', async () => {
    const child = independent();
    const closed = { ...child, hasMedicalDischarge: true };
    const current = record({ NEO1: { ...seed(child), neonatalMaternalRut: seed(mother()).rut } });
    const saved = sync(current, [closed]);
    expect(saved.diff.conflicts).toEqual([]);
    expect(saved.diff.pendingAdministrativeDischarges).toHaveLength(1);
    expect((await recover(saved.record)).mock.calls[0]?.[1]).toBe('144700554');
    expect(saved.record.beds.NEO1.rut).toBe('');
  });
  it('does not reinstate the same source number two days after birth', () => {
    const child = newborn('7906953');
    const first = sync(record({ H5C1: seed(mother()) }), [mother(), child]);
    expect(first.record.beds.H5C1.clinicalCrib?.rut).toBe('');
    const later = sync(
      { ...first.record, date: '2026-11-09' },
      [mother(), child],
      new Date('2026-11-09T12:00:00-05:00')
    );
    expect(later.record.beds.H5C1.clinicalCrib?.rut).toBe('');
  });
  it('past-day reimport does not reinstate a number observed at birth', () => {
    const child = newborn('7906953');
    const current = record({
      H5C1: {
        ...seed(mother()),
        clinicalCrib: { ...seed(child), rut: '', identityStatus: 'provisional' },
      },
    });
    const saved = sync(current, [mother(), child], new Date('2026-11-10T12:00:00-05:00'));
    expect(saved.record.beds.H5C1.clinicalCrib?.rut).toBe('');
  });
  it('independently discharged nested newborn does not archive stored folio', async () => {
    const child = newborn();
    const current = record({
      H5C1: {
        ...seed(mother()),
        clinicalCrib: { ...seed(child), neonatalMaternalRut: seed(mother()).rut },
      },
    });
    const diff = reconcileCensus(current, snapshot([mother(), child]), { reference: now });
    const enriched = applyEgresoReport(
      diff,
      [
        {
          encounterId: 'NEWBORN',
          run: child.run,
          patientName: 'RN de Ana Perez',
          bedLabel: 'CH5C1',
          servicio: child.service ?? '',
          edad: '0',
          destino: 'Domicilio',
          motivo: 'Alta hospitalaria',
          fechaEgreso: '07-11-2026 12:00',
          correctedDay: '2026-11-07',
          correctedTime: '12:00',
        },
      ],
      current
    );
    const saved = applyCensusImportDiff(current, enriched, {
      now,
      syncRunId: 'newborn-folio',
      idFactory: () => 'id',
    });
    expect(saved.record.discharges).toHaveLength(1);
    expect(saved.record.discharges[0].clinicalEpisodeId).toBe('NEWBORN');
    expect((await recover(saved.record)).mock.calls[0]?.[1]).toBe('144700554');
    expect(saved.record.discharges[0].rut).toBe('');
    expect(buildMovementsSummaryTables(saved.record)[0].rows[0][1]).not.toContain('790.695-3');
  });
  it('preserves an older infant passport on hospital readmission', () => {
    const child = {
      ...independent(),
      run: 'AB1234567',
      firstGivenName: 'Bebe',
      birthDate: '2026-10-22',
    };
    const current = record({ NEO1: seed(child) });
    expect(current.beds.NEO1.documentType).toBe('Pasaporte');
    const saved = sync(current, [child]);
    expect(saved.record.beds.NEO1.rut).toBe('AB1234567');
    expect(saved.record.beds.NEO1.documentType).toBe('Pasaporte');
  });
});

describe('newborn identity guards around the folio rule', () => {
  it('accepts a valid-DV number consistently at birth and two days later (accepted limitation)', () => {
    const child = newborn('222222222');
    const first = sync(record({ H5C1: seed(mother()) }), [mother(), child]);
    const later = sync(
      { ...first.record, date: '2026-11-09' },
      [mother(), child],
      new Date('2026-11-09T12:00:00-05:00')
    );
    expect(first.record.beds.H5C1.clinicalCrib?.rut).toBe('22.222.222-2');
    expect(later.record.beds.H5C1.clinicalCrib?.rut).toBe('22.222.222-2');
  });
  it('keeps a known numeric passport for the same newborn episode and queries it as its own document', async () => {
    const child = independent();
    const current = record({
      NEO1: {
        ...seed(child),
        rut: '7906953',
        documentType: 'Pasaporte',
        neonatalMaternalRut: seed(mother()).rut,
      },
    });
    const saved = sync(current, [child]);
    expect(saved.record.beds.NEO1.rut).toBe('7906953');
    expect(saved.record.beds.NEO1.documentType).toBe('Pasaporte');
    expect((await recover(saved.record)).mock.calls[0]?.[1]).toBe('7906953');
  });
  it('keeps mother and child separate when the child uses the maternal RUN', async () => {
    const child = newborn(mother().run);
    const saved = sync(record({ H5C1: seed(mother()) }), [mother(), child]);
    expect(saved.record.beds.H5C1.rut).toBe('14.470.055-4');
    expect(saved.record.beds.H5C1.clinicalEpisodeId).toBe('MOTHER');
    expect(saved.record.beds.H5C1.clinicalCrib?.rut).toBe('');
    expect(saved.record.beds.H5C1.clinicalCrib?.clinicalEpisodeId).toBe('NEWBORN');
    expect((await recover(saved.record)).mock.calls[0]).toEqual([
      'NEWBORN',
      '144700554',
      now.toISOString(),
      'maternal',
      '144700554',
    ]);
  });
  it('does not reinterpret an adult invalid-DV document as a newborn folio', () => {
    expect(
      newbornOwnRut({ rut: '790.695-3', age: '36', patientName: 'Ana Perez', bedMode: 'Cama' })
    ).toBe('790.695-3');
  });
});
