import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';
import type { ClinicalIncrementalMetrics } from '../domain/clinicalIncrementalSync';
import type { DeviceTextItem } from '../mapping/parseInvasiveDevices';
import type { RayenInvasiveDeviceEntry } from '../mapping/mapDeviceToInstance';
import type { RayenCudyrCategory, RayenHistoryScaleEvent } from '../bridge/rayenImportBridge';
import type { NursingStaffingProposal, RayenNursingActivity } from './nursingShiftInference';
import type { RayenSyncPerformance } from '@/types/domain/rayenSync';

export interface ClinicalFillDeps {
  /** Correlates aggregate diagnostics with the user-initiated synchronization run. */
  diagnosticRunId?: string;
  /** Limits enrichment to structurally confirmed episodes from the accepted census revision. */
  allowedClinicalEpisodeIds?: readonly string[];
  nurseCatalog?: string[];
  tensCatalog?: string[];
  fetchDeviceReport: (
    encId: string,
    fecha: string
  ) => Promise<{
    entries?: RayenInvasiveDeviceEntry[];
    base64: string;
    source?: 'json' | 'pdf';
    error?: string;
  }>;
  extractDeviceItems: (base64: string) => Promise<DeviceTextItem[]>;
  fetchHistoryScales: (
    encId: string,
    censusDate: string,
    options?: { lookbackDays?: number }
  ) => Promise<{
    events: RayenHistoryScaleEvent[];
    nursingActivity?: RayenNursingActivity[];
    effectiveLookbackDays?: number;
    coverageWindowStartIsoDay?: string;
    coverageWindowEndIsoDay?: string;
    error?: string;
  }>;
  fetchScalesForms: (encId: string) => Promise<{ forms: unknown[]; error?: string }>;
  fetchCudyrCategories: () => Promise<{ items: RayenCudyrCategory[]; error?: string }>;
  applyHistoricalCudyr?: (
    encId: string,
    censusDay: string,
    cudyr: ImportedCudyr
  ) => Promise<HistoricalCudyrApplyResult>;
  applyHistoricalCudyrBatch?: (
    censusDay: string,
    items: HistoricalCudyrBatchItem[]
  ) => Promise<HistoricalCudyrBatchItemResult[]>;
  applyPatch: (patch: DailyRecordPatch, target: ClinicalFillPatchTarget) => Promise<void>;
  /** Selects exactly one persistence owner for the whole fill run. */
  persistenceStrategy?: ClinicalFillPersistenceStrategy;
  now: () => Date;
  createId: () => string;
  monotonicNow?: () => number;
}

export interface ClinicalFillPatchOperation {
  patch: DailyRecordPatch;
  target: ClinicalFillPatchTarget;
  /** Number of effective clinical fields, excluding the incremental checkpoint. */
  clinicalFieldCount?: number;
  checkpointChanged?: boolean;
}

export interface ClinicalFillBatchEvidence {
  mode: 'shadow' | 'enforced';
  parity: 'matched' | 'mismatch' | 'unavailable';
  clinicalTargets: number;
  checkpointOnlyTargets: number;
  checkpointTargets: number;
  requestedFields: number;
  backendTargets?: number;
  backendFields?: number;
}

export interface ClinicalFillBatchApplyResult {
  patientWrites: number;
  historySnapshots: number;
  retries?: number;
  failures?: ClinicalFillBatchApplyFailure[];
  batch?: ClinicalFillBatchEvidence;
}

/**
 * A run may write each patient immediately, observe those writes afterwards, or defer all
 * writes to one authority batch. The discriminant prevents mixed ownership configurations.
 */
export type ClinicalFillPersistenceStrategy =
  | {
      disposition: 'immediate';
      persist: (operations: ClinicalFillPatchOperation[]) => Promise<void>;
    }
  | {
      disposition: 'observe';
      persist: (operations: ClinicalFillPatchOperation[]) => Promise<ClinicalFillBatchEvidence>;
    }
  | {
      disposition: 'deferred';
      persist: (operations: ClinicalFillPatchOperation[]) => Promise<ClinicalFillBatchApplyResult>;
    };

export interface ClinicalFillBatchApplyFailure {
  index: number;
  message: string;
}

export interface ClinicalFillPatchTarget {
  censusDate: string;
  bedId: string;
  clinicalEpisodeId: string;
  clinicalCrib?: true;
  captureHistorySnapshot?: boolean;
}

export interface HistoricalCudyrApplyResult {
  persisted: boolean;
  changed: boolean;
  applicable?: boolean;
}

export interface HistoricalCudyrBatchItem {
  clinicalEpisodeId: string;
  cudyr: ImportedCudyr;
}

export interface HistoricalCudyrBatchItemResult extends HistoricalCudyrApplyResult {
  clinicalEpisodeId: string;
}

export interface ClinicalFillError {
  bedId: string;
  clinicalEpisodeId?: string;
  source: 'devices' | 'scales' | 'vitals' | 'staffing' | 'cudyr' | 'patch';
  message: string;
}

export interface ClinicalFillSummary {
  total: number;
  patched: number;
  errors: ClinicalFillError[];
  staffingProposal?: NursingStaffingProposal;
  incremental?: ClinicalIncrementalMetrics & {
    patientWrites: number;
    historySnapshots: number;
    clinicalTargets?: number;
    checkpointOnlyTargets?: number;
    batch?: ClinicalFillBatchEvidence;
  };
  performance?: RayenSyncPerformance;
}

export interface ClinicalFillProgress {
  done: number;
  total: number;
}
