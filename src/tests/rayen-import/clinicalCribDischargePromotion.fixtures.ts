import {
  applyCensusImportDiff,
  applyEgresoReport,
  reconcileCensus,
  rayenToPatientData,
  type EgresoReportRow,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

export const REFERENCE = new Date(2026, 6, 8);

export const encounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: 'MOTHER',
  run: '144700554',
  firstGivenName: 'Ana',
  firstFamilyName: 'Perez',
  birthDate: '1980-01-01',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H5',
  bed: 'C1',
  admissionDatetime: '2026-07-08T10:00:00-06:00',
  diagnosis: 'Control',
  ...overrides,
});

export const newborn = (): RayenEncounter =>
  encounter({
    encounterId: 'NEWBORN',
    run: '',
    firstGivenName: 'RN de Ana',
    birthDate: '2026-07-08',
    room: 'Cunas',
    bed: 'CH5C1',
    clinicalCribParentBedId: 'H5C1',
  });

export const seed = (source: RayenEncounter): PatientData =>
  rayenToPatientData(source, REFERENCE).patient;

export const recordWith = (mother: RayenEncounter, child: RayenEncounter): DailyRecord => ({
  date: '2026-07-08',
  beds: { H5C1: { ...seed(mother), clinicalCrib: seed(child) } },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

export const snapshotOf = (encounters: RayenEncounter[]): RayenCensusSnapshot => ({
  capturedAt: '2026-07-08T20:00:00-06:00',
  facilityId: 1342,
  encounters,
});

export const dischargeRow = (patient: RayenEncounter): EgresoReportRow => ({
  encounterId: patient.encounterId,
  run: patient.run,
  patientName: `${patient.firstGivenName} ${patient.firstFamilyName}`,
  bedLabel: 'H5C1',
  servicio: patient.service ?? '',
  edad: '1',
  destino: 'Domicilio',
  motivo: 'Alta hospitalaria',
  fechaEgreso: '08-07-2026 12:00',
});

export const apply = (
  current: DailyRecord,
  rows: EgresoReportRow[],
  encounters: RayenEncounter[]
) => {
  const diff = reconcileCensus(current, snapshotOf(encounters), { reference: REFERENCE });
  const enriched = applyEgresoReport(diff, rows, current);
  const applied = applyCensusImportDiff(current, enriched, {
    idFactory: () => 'movement-id',
    now: REFERENCE,
    syncRunId: 'crib-discharge-sync',
  });
  return { enriched, applied };
};
