import { documentIdentityKey } from '@/utils/rutUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  PRESCRIPTION_TYPES,
  resolvePrescriptionAssignmentScope,
  type PrescriptionRecord,
  type PrescriptionType,
} from '@/types/prescriptionTypes';
import type { PrescriptionBedRowData } from '@/features/prescriptions/components/PrescriptionBedRow';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { formatCalendarDate } from '@/utils/dateDisplayUtils';

export const todayIso = (): string => getTodayISO();

export const previousIsoDay = (iso: string): string => {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const formatDayLabel = (iso: string): string =>
  formatCalendarDate(iso, { weekday: 'long', day: 'numeric', month: 'long' }) ?? iso;

export const isUnassignedRecord = (record: PrescriptionRecord): boolean =>
  resolvePrescriptionAssignmentScope(record) === 'unassigned';

export const isStockRecord = (record: PrescriptionRecord): boolean =>
  resolvePrescriptionAssignmentScope(record) === 'hospitalized_stock';

const createEmptyPrescriptionBuckets = (): Record<PrescriptionType, PrescriptionRecord[]> => ({
  comun: [],
  psicotropicos: [],
  benzodiazepinas: [],
});

const normalizeIdentityToken = (value: string | undefined): string =>
  value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';

export const prescriptionBedRowKey = (row: PrescriptionBedRowData): string =>
  JSON.stringify([
    row.bedId,
    row.isDischargeSnapshot ? 'discharged' : 'current',
    row.isDischargeSnapshot
      ? documentIdentityKey(row.patientRut) || normalizeIdentityToken(row.patientName)
      : '',
  ]);

export const buildBedRows = (
  daily: DailyRecord | null,
  records: PrescriptionRecord[]
): PrescriptionBedRowData[] => {
  const byBed = new Map<string, PrescriptionBedRowData>();
  const dischargedRows = new Map<string, PrescriptionBedRowData>();
  const activeRowsByRut = new Map<string, PrescriptionBedRowData>();
  const activeRowsByName = new Map<string, PrescriptionBedRowData | null>();

  for (const [bedId, patient] of Object.entries(daily?.beds || {})) {
    if (!patient || patient.isBlocked) continue;
    const hasIdentity = Boolean(patient.patientName?.trim()) || Boolean(patient.rut?.trim());
    if (!hasIdentity) continue;
    const row = {
      bedId,
      patientName: patient.patientName?.trim() ?? '',
      patientRut: patient.rut?.trim() ?? '',
      byType: createEmptyPrescriptionBuckets(),
    };
    byBed.set(bedId, row);
    const rutKey = documentIdentityKey(row.patientRut);
    if (rutKey) activeRowsByRut.set(rutKey, row);
    const nameKey = normalizeIdentityToken(row.patientName);
    if (nameKey) {
      activeRowsByName.set(nameKey, activeRowsByName.has(nameKey) ? null : row);
    }
  }

  for (const record of records) {
    if (resolvePrescriptionAssignmentScope(record) !== 'patient') continue;
    if (!record.bedId) continue;

    const rutKey = documentIdentityKey(record.patientRut);
    const nameKey = normalizeIdentityToken(record.patientName);
    let row = rutKey ? activeRowsByRut.get(rutKey) : undefined;

    if (!row && !rutKey && nameKey) {
      row = activeRowsByName.get(nameKey) || undefined;
    }

    if (!row) {
      const bedRow = byBed.get(record.bedId);
      const bedRowRutKey = documentIdentityKey(bedRow?.patientRut);
      const bedRowNameKey = normalizeIdentityToken(bedRow?.patientName);
      const hasRutConflict = Boolean(rutKey && bedRowRutKey && rutKey !== bedRowRutKey);
      const hasNameConflict = Boolean(
        !rutKey && nameKey && bedRowNameKey && nameKey !== bedRowNameKey
      );
      row = bedRow && !hasRutConflict && !hasNameConflict ? bedRow : undefined;
    }

    if (!row) {
      row = {
        bedId: record.bedId,
        patientName: record.patientName?.trim() ?? '',
        patientRut: record.patientRut?.trim() ?? '',
        isDischargeSnapshot: true,
        byType: createEmptyPrescriptionBuckets(),
      };
      const key = prescriptionBedRowKey(row);
      const existing = dischargedRows.get(key);
      if (existing) row = existing;
      else dischargedRows.set(key, row);
    }
    row.byType[record.prescriptionType].push(record);
  }

  return [...byBed.values(), ...dischargedRows.values()].sort(
    (a, b) =>
      a.bedId.localeCompare(b.bedId, 'es', { numeric: true }) ||
      Number(Boolean(a.isDischargeSnapshot)) - Number(Boolean(b.isDischargeSnapshot))
  );
};

export { PRESCRIPTION_TYPES };
