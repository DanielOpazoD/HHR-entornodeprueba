import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { RayenSyncRun } from '../domain/rayenSyncHistory';
import type { RayenSyncPerformanceDelta } from '@/types/domain/rayenSync';
import type { ConfirmedRayenCensusApplyResult } from './useRayenCensusDiffApplication';
import type { ConfirmedRayenCensusHandoff } from './rayenCensusPersistenceGuard';
import type { RayenImportState } from './rayenImportState';
import type { PreparedRayenSyncContext } from './rayenSyncTemporalContext';
import type { RayenSyncExecutionAction, RayenSyncExecutionState } from './rayenSyncExecutionState';

export type RunSerializedRayenPersistence = <T>(operation: () => Promise<T>) => Promise<T>;

export interface UseRayenSnapshotPreviewInput {
  dailyRecord: DailyRecordRepositoryPort;
  isAdmin: boolean;
  setState: Dispatch<SetStateAction<RayenImportState>>;
  dispatchExecution?: Dispatch<RayenSyncExecutionAction>;
  executionRef?: RefObject<RayenSyncExecutionState>;
  selectedDateRef?: RefObject<string | undefined>;
  clearSyncTimeout: () => void;
  applyDiff: (
    record: DailyRecord,
    diff: CensusImportDiff
  ) => Promise<ConfirmedRayenCensusApplyResult>;
  persistAppliedRun: (record: DailyRecord, diff: CensusImportDiff) => Promise<DailyRecord>;
  fillDevicesInBackground: (source: DailyRecord | ConfirmedRayenCensusHandoff) => Promise<void>;
  failRun: (reason: 'apply_failed', runId?: string) => Promise<void>;
  ensureRun: () => RayenSyncRun;
  getRun: (runId: string) => RayenSyncRun | undefined;
  recordRunPerformance: (delta: RayenSyncPerformanceDelta, runId?: string) => void;
  preparedSyncContextRef: RefObject<PreparedRayenSyncContext | null>;
  runSerializedPersistence: RunSerializedRayenPersistence;
}
