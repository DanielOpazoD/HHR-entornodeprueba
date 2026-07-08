import {
  getActiveCma,
  getActiveDischarges,
  getActiveTransfers,
} from '@/application/census/movementTombstonePolicy';
import { MinsalMovementKind, SpecialtyReclassification } from '@/types/minsalTypes';
import type { DailyRecord } from '@/features/analytics/contracts/analyticsDailyRecordContracts';
import { resolveReportingSpecialty } from '@/services/calculations/minsal/specialtyReporting';
import {
  normalizeMovementReportingSnapshot,
  type ReportingMovementSnapshot,
} from '@/services/calculations/minsal/movementCompatibility';

export interface AnalyticsMovementReclassificationRow {
  key: string;
  date: string;
  movementKind: MinsalMovementKind;
  movementId: string;
  patientName: string;
  rut: string;
  diagnosis: string;
  originalSpecialty: string;
  reportingSpecialty: string;
  reportingSpecialtySource: 'original' | 'grouped' | 'manual';
}

const buildKey = (date: string, movementKind: MinsalMovementKind, movementId: string): string =>
  `${date}:${movementKind}:${movementId}`;

type ReclassificationMovement = ReportingMovementSnapshot & {
  id: string;
  patientName?: string;
  rut?: string;
  diagnosis?: string;
  specialty?: string;
};

const resolveMovementSnapshot = (
  movementKind: MinsalMovementKind,
  movement: ReclassificationMovement
): ReclassificationMovement =>
  movementKind === 'cma' ? movement : normalizeMovementReportingSnapshot(movement);

const createRow = (
  record: DailyRecord,
  movementKind: MinsalMovementKind,
  movement: ReclassificationMovement,
  specialtyReclassifications: SpecialtyReclassification[]
): AnalyticsMovementReclassificationRow => {
  const snapshot = resolveMovementSnapshot(movementKind, movement);
  const resolution = resolveReportingSpecialty({
    specialty: snapshot.specialty,
    movementKind,
    movementId: movement.id,
    date: record.date,
    options: { specialtyReclassifications },
  });

  return {
    key: buildKey(record.date, movementKind, movement.id),
    date: record.date,
    movementKind,
    movementId: movement.id,
    patientName: movement.patientName || '',
    rut: snapshot.rut || movement.rut || '',
    diagnosis: snapshot.diagnosis || movement.diagnosis || '',
    originalSpecialty: resolution.originalSpecialty,
    reportingSpecialty: resolution.reportingSpecialty,
    reportingSpecialtySource: resolution.reportingSpecialtySource || 'original',
  };
};

export const buildAnalyticsMovementReclassificationRows = (
  records: DailyRecord[],
  specialtyReclassifications: SpecialtyReclassification[]
): AnalyticsMovementReclassificationRow[] =>
  records
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap(record => [
      ...getActiveDischarges(record.discharges).map(item =>
        createRow(record, 'discharge', item, specialtyReclassifications)
      ),
      ...getActiveTransfers(record.transfers).map(item =>
        createRow(record, 'transfer', item, specialtyReclassifications)
      ),
      ...getActiveCma(record.cma).map(item =>
        createRow(record, 'cma', item, specialtyReclassifications)
      ),
    ]);

export const applySpecialtyReclassificationChange = (
  current: SpecialtyReclassification[],
  row: AnalyticsMovementReclassificationRow,
  specialty: string,
  updatedAt: string = new Date().toISOString()
): SpecialtyReclassification[] => {
  const withoutCurrent = current.filter(
    item =>
      item.date !== row.date ||
      item.movementKind !== row.movementKind ||
      item.movementId !== row.movementId
  );

  if (!specialty) {
    return withoutCurrent;
  }

  return [
    ...withoutCurrent,
    {
      date: row.date,
      movementKind: row.movementKind,
      movementId: row.movementId,
      specialty,
      updatedAt,
    },
  ];
};
