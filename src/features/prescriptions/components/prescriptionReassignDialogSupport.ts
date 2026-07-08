import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import {
  formatDayLabel,
  todayIso,
} from '@/features/prescriptions/components/prescriptionBedGridSupport';
import { isMovementDeleted } from '@/application/census/movementTombstonePolicy';

export interface DailyBedOption {
  bedId: string;
  patientName: string;
  patientRut: string;
  patientStatus: 'active' | 'discharge' | 'transfer';
}

interface ResolvedDayPayload {
  bedOptions: DailyBedOption[];
  resolvedDay: string | null;
}

export const FALLBACK_DAYS_BACK = 7;

export { formatDayLabel, todayIso };

const shiftIsoDay = (iso: string, deltaDays: number): string => {
  const [year, month, day] = iso.split('-').map(Number);
  const d = new Date(year, (month ?? 1) - 1, day ?? 1);
  d.setDate(d.getDate() + deltaDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const formatPatientStatus = (status: DailyBedOption['patientStatus']): string => {
  if (status === 'discharge') return 'Alta (egreso)';
  if (status === 'transfer') return 'Traslado';
  return 'Activo';
};

export const buildBedOptions = (record: DailyRecord | null): DailyBedOption[] => {
  if (!record) return [];
  const seen = new Set<string>();
  const remember = (option: DailyBedOption): boolean => {
    const rutKey = option.patientRut
      .trim()
      .toLowerCase()
      .replace(/[^0-9k]/g, '');
    const identityKey = rutKey || `bed:${option.bedId}`;
    if (seen.has(identityKey)) return false;
    seen.add(identityKey);
    return true;
  };

  const activeOptions = Object.entries(record.beds || {})
    .filter(
      ([, patient]) =>
        patient && !patient.isBlocked && (patient.patientName?.trim() || patient.rut?.trim())
    )
    .map(([bedId, patient]) => ({
      bedId,
      patientName: patient.patientName?.trim() ?? '',
      patientRut: patient.rut?.trim() ?? '',
      patientStatus: 'active' as const,
    }));

  const movementOptions = [
    ...buildMovementBedOptions(record.discharges, 'discharge'),
    ...buildMovementBedOptions(record.transfers, 'transfer'),
  ];

  return [...activeOptions, ...movementOptions]
    .filter(remember)
    .sort((a, b) => a.bedId.localeCompare(b.bedId, 'es', { numeric: true }));
};

export const resolveDayWithBeds = async (startIso: string): Promise<ResolvedDayPayload> => {
  for (let offset = 0; offset <= FALLBACK_DAYS_BACK; offset += 1) {
    const candidate = offset === 0 ? startIso : shiftIsoDay(startIso, -offset);
    const record = await getRecordFromFirestore(candidate);
    const options = buildBedOptions(record);
    if (options.length > 0) return { bedOptions: options, resolvedDay: candidate };
  }
  return { bedOptions: [], resolvedDay: null };
};

const buildMovementBedOptions = (
  movements: unknown,
  patientStatus: 'discharge' | 'transfer'
): DailyBedOption[] => {
  if (!Array.isArray(movements)) return [];
  return movements
    .map((movement): DailyBedOption | null => {
      if (!movement || typeof movement !== 'object') return null;
      const item = movement as {
        bedId?: string;
        bedName?: string;
        patientName?: string;
        rut?: string;
        deletedAt?: string;
      };
      if (isMovementDeleted(item)) return null;
      const bedId = item.bedId?.trim() || item.bedName?.trim() || '';
      const patientName = item.patientName?.trim() ?? '';
      const patientRut = item.rut?.trim() ?? '';
      if (!bedId || (!patientName && !patientRut)) return null;
      return { bedId, patientName, patientRut, patientStatus };
    })
    .filter((option): option is DailyBedOption => Boolean(option));
};
