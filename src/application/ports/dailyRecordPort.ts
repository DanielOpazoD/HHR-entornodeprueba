import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type { CopyPatientToDateResult } from '@/services/repositories/dailyRecordRepositoryInitializationService';
import type {
  SaveDailyRecordResult,
  SyncDailyRecordResult,
  UpdatePartialDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';
import type {
  DailyRecordReadResult,
  LocalDailyRecordReadResult,
} from '@/services/repositories/contracts/dailyRecordQueries';
import type {
  PartialUpdateDailyRecordOptions,
  SaveDailyRecordOptions,
} from '@/services/repositories/contracts/dailyRecordCommands';

type DailyRecordReadService =
  typeof import('@/services/repositories/dailyRecordRepositoryReadService');
type DailyRecordInitializationService =
  typeof import('@/services/repositories/dailyRecordRepositoryInitializationService');
type DailyRecordWriteService =
  typeof import('@/services/repositories/dailyRecordRepositoryWriteService');
type DailyRecordSyncService =
  typeof import('@/services/repositories/dailyRecordRepositorySyncService');
type DailyRecordFacadeSupportService =
  typeof import('@/services/repositories/dailyRecordRepositoryFacadeSupport');

let readServicePromise: Promise<DailyRecordReadService> | null = null;
let initializationServicePromise: Promise<DailyRecordInitializationService> | null = null;
let writeServicePromise: Promise<DailyRecordWriteService> | null = null;
let syncServicePromise: Promise<DailyRecordSyncService> | null = null;
let facadeSupportServicePromise: Promise<DailyRecordFacadeSupportService> | null = null;

const loadDailyRecordReadService = (): Promise<DailyRecordReadService> =>
  (readServicePromise ??= import('@/services/repositories/dailyRecordRepositoryReadService'));

const loadDailyRecordInitializationService = (): Promise<DailyRecordInitializationService> =>
  (initializationServicePromise ??=
    import('@/services/repositories/dailyRecordRepositoryInitializationService'));

const loadDailyRecordWriteService = (): Promise<DailyRecordWriteService> =>
  (writeServicePromise ??= import('@/services/repositories/dailyRecordRepositoryWriteService'));

const loadDailyRecordSyncService = (): Promise<DailyRecordSyncService> =>
  (syncServicePromise ??= import('@/services/repositories/dailyRecordRepositorySyncService'));

const loadDailyRecordFacadeSupportService = (): Promise<DailyRecordFacadeSupportService> =>
  (facadeSupportServicePromise ??=
    import('@/services/repositories/dailyRecordRepositoryFacadeSupport'));

const withReadService = <T>(
  operation: (service: DailyRecordReadService) => Promise<T> | T
): Promise<T> => loadDailyRecordReadService().then(operation);

const withInitializationService = <T>(
  operation: (service: DailyRecordInitializationService) => Promise<T> | T
): Promise<T> => loadDailyRecordInitializationService().then(operation);

const withWriteService = <T>(
  operation: (service: DailyRecordWriteService) => Promise<T> | T
): Promise<T> => loadDailyRecordWriteService().then(operation);

const withSyncService = <T>(
  operation: (service: DailyRecordSyncService) => Promise<T> | T
): Promise<T> => loadDailyRecordSyncService().then(operation);

const withFacadeSupportService = <T>(
  operation: (service: DailyRecordFacadeSupportService) => Promise<T> | T
): Promise<T> => loadDailyRecordFacadeSupportService().then(operation);

const createLazySubscription = (
  start: (service: DailyRecordSyncService) => () => void
): (() => void) => {
  let active = true;
  let unsubscribe = () => {};

  void loadDailyRecordSyncService()
    .then(service => {
      if (!active) {
        return;
      }
      unsubscribe = start(service);
    })
    .catch(() => {
      // Keep a stable no-op unsubscribe. Bootstrap/runtime telemetry captures the chunk error path.
    });

  return () => {
    active = false;
    unsubscribe();
  };
};

const updatePartialDailyRecord = (
  date: string,
  patch: DailyRecordPatch,
  options?: PartialUpdateDailyRecordOptions
): Promise<UpdatePartialDailyRecordResult> =>
  withWriteService(service =>
    options
      ? service.updatePartialDetailed(date, patch, options)
      : service.updatePartialDetailed(date, patch)
  );

const saveDailyRecord = (
  record: DailyRecord,
  expectedLastUpdated?: string,
  options?: SaveDailyRecordOptions
): Promise<SaveDailyRecordResult> =>
  withWriteService(service =>
    options
      ? service.saveDetailed(record, expectedLastUpdated, options)
      : service.saveDetailed(record, expectedLastUpdated)
  );

const deleteDailyRecord = (date: string): Promise<void> =>
  withFacadeSupportService(service => service.deleteDailyRecordAcrossStores(date));

const syncDailyRecordWithFirestore = (date: string): Promise<SyncDailyRecordResult | null> =>
  withSyncService(service => service.syncWithFirestoreDetailed(date));

const adoptAuthoritativeDailyRecord = (
  record: DailyRecord,
  alreadyAppliedPatch?: DailyRecordPatch
): Promise<DailyRecord> =>
  withSyncService(service => service.adoptAuthoritativeRecord(record, alreadyAppliedPatch));

export interface DailyRecordReadPort {
  getPreviousDay: (date: string) => Promise<DailyRecord | null>;
  getAvailableDates: () => Promise<string[]>;
  getMonthRecords: (year: number, monthZeroBased: number) => Promise<DailyRecord[]>;
  getForDate: (date: string) => Promise<DailyRecord | null>;
  getForDateWithMeta: (date: string, syncFromRemote?: boolean) => Promise<DailyRecordReadResult>;
  /** Exact remote census used as the base for an optimistic structural CAS. */
  getAuthoritativeForDate: (date: string) => Promise<DailyRecord | null>;
  /** Exact local candidate used only to retain pending app-managed fields before structural CAS. */
  getLocalForDate: (date: string) => Promise<DailyRecord | null>;
  /** Exact local candidate plus proof that its version remains in the active outbox. */
  getLocalForDateWithMeta: (date: string) => Promise<LocalDailyRecordReadResult>;
  initializeDay: (date: string, copyFromDate?: string) => Promise<DailyRecord>;
  getPreviousDayWithMeta: (date: string) => Promise<DailyRecordReadResult>;
}

export interface DailyRecordWritePort {
  updatePartial: (
    date: string,
    patch: DailyRecordPatch,
    options?: PartialUpdateDailyRecordOptions
  ) => Promise<UpdatePartialDailyRecordResult>;
  save: (record: DailyRecord, expectedLastUpdated?: string) => Promise<SaveDailyRecordResult>;
  delete: (date: string) => Promise<void>;
}

export interface DailyRecordSyncPort {
  syncWithFirestoreDetailed: (date: string) => Promise<SyncDailyRecordResult | null>;
}

export type DailyRecordAnalysisPort = Pick<
  DailyRecordReadPort & DailyRecordWritePort,
  'getAvailableDates' | 'getForDate' | 'updatePartial'
>;

/**
 * Canonical repository-shaped port for UI/runtime consumers that still expect a
 * single `dailyRecord` dependency instead of separate read/write/sync ports.
 */
export interface DailyRecordRepositoryPort
  extends DailyRecordReadPort, DailyRecordWritePort, DailyRecordSyncPort {
  /** Persist a record already confirmed by server authority without issuing another remote write. */
  adoptAuthoritativeRecord: (
    record: DailyRecord,
    alreadyAppliedPatch?: DailyRecordPatch
  ) => Promise<DailyRecord>;
  saveDetailed: (
    record: DailyRecord,
    expectedLastUpdated?: string,
    options?: SaveDailyRecordOptions
  ) => Promise<SaveDailyRecordResult>;
  updatePartialDetailed: (
    date: string,
    patch: DailyRecordPatch,
    options?: PartialUpdateDailyRecordOptions
  ) => Promise<UpdatePartialDailyRecordResult>;
  subscribe: (
    date: string,
    callback: (record: DailyRecord | null, hasPendingWrites: boolean) => void
  ) => () => void;
  subscribeDetailed: (
    date: string,
    callback: (result: SyncDailyRecordResult, hasPendingWrites: boolean) => void
  ) => () => void;
  deleteDay: (date: string) => Promise<void>;
  copyPatientToDateDetailed: (
    sourceDate: string,
    sourceBedId: string,
    targetDate: string,
    targetBedId: string
  ) => Promise<CopyPatientToDateResult>;
}

export const defaultDailyRecordReadPort: DailyRecordReadPort = {
  getPreviousDay: date => withReadService(service => service.getPreviousDay(date)),
  getAvailableDates: () => withReadService(service => service.getAvailableDates()),
  getMonthRecords: (year, monthZeroBased) =>
    withReadService(service => service.getMonthRecords(year, monthZeroBased)),
  getForDate: date => withReadService(service => service.getForDate(date)),
  getForDateWithMeta: (date, syncFromRemote = true) =>
    withReadService(service => service.getForDateWithMeta(date, syncFromRemote)),
  getAuthoritativeForDate: date =>
    withReadService(service => service.getAuthoritativeForDate(date)),
  getLocalForDate: date => withReadService(service => service.getLocalForDate(date)),
  getLocalForDateWithMeta: date =>
    withReadService(service => service.getLocalForDateWithMeta(date)),
  initializeDay: (date, copyFromDate) =>
    withInitializationService(service => service.initializeDay(date, copyFromDate)),
  getPreviousDayWithMeta: date => withReadService(service => service.getPreviousDayWithMeta(date)),
};

export const defaultDailyRecordWritePort: DailyRecordWritePort = {
  updatePartial: updatePartialDailyRecord,
  save: saveDailyRecord,
  delete: deleteDailyRecord,
};

export const defaultDailyRecordSyncPort: DailyRecordSyncPort = {
  syncWithFirestoreDetailed: syncDailyRecordWithFirestore,
};

export const defaultDailyRecordAnalysisPort: DailyRecordAnalysisPort = {
  getAvailableDates: defaultDailyRecordReadPort.getAvailableDates,
  getForDate: defaultDailyRecordReadPort.getForDate,
  updatePartial: defaultDailyRecordWritePort.updatePartial,
};

export const defaultDailyRecordRepositoryPort: DailyRecordRepositoryPort = {
  ...defaultDailyRecordReadPort,
  ...defaultDailyRecordWritePort,
  ...defaultDailyRecordSyncPort,
  adoptAuthoritativeRecord: adoptAuthoritativeDailyRecord,
  saveDetailed: saveDailyRecord,
  updatePartialDetailed: updatePartialDailyRecord,
  subscribe: (date, callback) =>
    createLazySubscription(service => service.subscribe(date, callback)),
  subscribeDetailed: (date, callback) =>
    createLazySubscription(service => service.subscribeDetailed(date, callback)),
  deleteDay: deleteDailyRecord,
  copyPatientToDateDetailed: (sourceDate, sourceBedId, targetDate, targetBedId) =>
    withInitializationService(service =>
      service.copyPatientToDateDetailed(sourceDate, sourceBedId, targetDate, targetBedId)
    ),
};
