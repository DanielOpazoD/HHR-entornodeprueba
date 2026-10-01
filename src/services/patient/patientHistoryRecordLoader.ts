import type { DailyRecordPatientHistoryState } from '@/services/contracts/dailyRecordServiceContracts';
import type { PatientData } from '@/types/domain/patient';
import type { DischargeData, TransferData } from '@/types/domain/movements';
import type { HospitalizationEvent } from '@/types/domain/patientMaster';
import {
  getAllRecords,
  getRecordsRange,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import {
  getRecordPagesFromFirestore,
  getRecordsRangeFromFirestore,
} from '@/services/storage/firestore';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { getTodayISO } from '@/utils/dateCoreUtils';

export interface PatientHistoryLoadOptions {
  dateRange?: { startDate: string; endDate: string };
  hospitalizationHints?: HospitalizationEvent[];
  lastAdmission?: string;
  lastDischarge?: string;
  forceFullRemoteHydration?: boolean;
  signal?: AbortSignal;
  onProgress?: (recordsRead: number) => void;
}

type HistoryPatient = Pick<
  PatientData,
  'rut' | 'patientName' | 'admissionDate' | 'admissionOrigin' | 'admissionTime'
> & {
  clinicalCrib?: Pick<
    NonNullable<PatientData['clinicalCrib']>,
    'rut' | 'patientName' | 'admissionDate'
  >;
};
export interface PatientHistoryRecord {
  date: string;
  beds: Record<string, HistoryPatient>;
  discharges: Pick<
    DischargeData,
    'rut' | 'bedId' | 'bedName' | 'bedType' | 'time' | 'status' | 'dischargeType' | 'deletedAt'
  >[];
  transfers: Pick<
    TransferData,
    | 'rut'
    | 'bedId'
    | 'bedName'
    | 'bedType'
    | 'time'
    | 'evacuationMethod'
    | 'receivingCenter'
    | 'deletedAt'
  >[];
}

/** History never retains full clinical snapshots or mutates the editable census cache. */
export const projectPatientHistoryRecord = (
  record: DailyRecordPatientHistoryState
): PatientHistoryRecord => ({
  date: record.date,
  beds: Object.fromEntries(
    Object.entries(record.beds).map(([key, patient]) => [
      key,
      {
        rut: patient.rut,
        patientName: patient.patientName,
        admissionDate: patient.admissionDate,
        admissionOrigin: patient.admissionOrigin,
        admissionTime: patient.admissionTime,
        ...(patient.clinicalCrib
          ? {
              clinicalCrib: {
                rut: patient.clinicalCrib.rut,
                patientName: patient.clinicalCrib.patientName,
                admissionDate: patient.clinicalCrib.admissionDate,
              },
            }
          : {}),
      },
    ])
  ),
  discharges: (record.discharges ?? []).map(
    ({ rut, bedId, bedName, bedType, time, status, dischargeType, deletedAt }) => ({
      rut,
      bedId,
      bedName,
      bedType,
      time,
      status,
      dischargeType,
      deletedAt,
    })
  ),
  transfers: (record.transfers ?? []).map(
    ({ rut, bedId, bedName, bedType, time, evacuationMethod, receivingCenter, deletedAt }) => ({
      rut,
      bedId,
      bedName,
      bedType,
      time,
      evacuationMethod,
      receivingCenter,
      deletedAt,
    })
  ),
});

const resolveLatestAdmissionDateHint = (options?: PatientHistoryLoadOptions): string | null => {
  const admissionHint = (options?.hospitalizationHints ?? [])
    .filter(event => event.type === 'Ingreso')
    .map(event => event.date)
    .sort()
    .at(-1);

  return admissionHint || options?.lastAdmission || null;
};

const resolveLatestCloseDateHint = (options?: PatientHistoryLoadOptions): string | null => {
  const closeHint = (options?.hospitalizationHints ?? [])
    .filter(
      event =>
        event.type === 'Egreso' || event.type === 'Traslado' || event.type === 'Fallecimiento'
    )
    .map(event => event.date)
    .sort()
    .at(-1);

  return closeHint || options?.lastDischarge || null;
};

const resolveRemoteHistoryRange = (
  options?: PatientHistoryLoadOptions
): { startDate: string; endDate: string } | null => {
  const startDate = resolveLatestAdmissionDateHint(options);
  if (!startDate) {
    return null;
  }

  const latestKnownCloseDate = [resolveLatestCloseDateHint(options)]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const today = getTodayISO();
  const endDate =
    latestKnownCloseDate && latestKnownCloseDate >= startDate ? latestKnownCloseDate : today;

  return {
    startDate,
    endDate: endDate >= startDate ? endDate : startDate,
  };
};

export const loadPatientHistoryRecords = async (options?: PatientHistoryLoadOptions) => {
  options?.signal?.throwIfAborted();
  const remoteRange = options?.forceFullRemoteHydration
    ? null
    : (options?.dateRange ?? resolveRemoteHistoryRange(options));
  if (remoteRange) {
    const validDay = (day: string) => {
      const date = new Date(`${day}T12:00:00Z`);
      return (
        /^\d{4}-\d{2}-\d{2}$/.test(day) &&
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === day
      );
    };
    if (
      !validDay(remoteRange.startDate) ||
      !validDay(remoteRange.endDate) ||
      remoteRange.startDate > remoteRange.endDate
    ) {
      throw new Error('Invalid history date range');
    }
  }
  const remoteEnabled = isFirestoreEnabled();
  if (remoteEnabled) {
    try {
      const records: PatientHistoryRecord[] = [];
      if (remoteRange) {
        records.push(
          ...(
            await getRecordsRangeFromFirestore(remoteRange.startDate, remoteRange.endDate, {
              requireServer: true,
            })
          ).map(projectPatientHistoryRecord)
        );
        options?.signal?.throwIfAborted();
        options?.onProgress?.(records.length);
      } else {
        for await (const page of getRecordPagesFromFirestore(options?.signal)) {
          records.push(...page.map(projectPatientHistoryRecord));
          options?.onProgress?.(records.length);
        }
      }
      options?.signal?.throwIfAborted();
      // Successful server reads are authoritative, including removed/absent days.
      // A history lookup must not overwrite the editable census cache.
      return { records, source: 'server' as const };
    } catch {
      options?.signal?.throwIfAborted();
      // Local data remains useful, but must never be presented as a complete server read.
    }
  }
  const records = remoteRange
    ? await getRecordsRange(remoteRange.startDate, remoteRange.endDate)
    : Object.values(await getAllRecords());
  options?.signal?.throwIfAborted();
  return {
    records: records.map(projectPatientHistoryRecord),
    source: remoteEnabled ? ('local' as const) : ('local-only' as const),
  };
};
