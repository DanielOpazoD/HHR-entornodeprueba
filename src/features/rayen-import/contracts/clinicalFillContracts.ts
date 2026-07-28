import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';
import type { ClinicalIncrementalMetrics } from '../domain/clinicalIncrementalSync';
import type { DeviceTextItem } from '../mapping/parseInvasiveDevices';
import type { RayenCudyrCategory, RayenHistoryScaleEvent } from '../bridge/rayenImportBridge';
import type { NursingStaffingProposal, RayenNursingActivity } from './nursingShiftInference';
import type { RayenSyncPerformance } from '@/types/domain/rayenSync';

export interface ClinicalFillDeps {
  nurseCatalog?: string[];
  tensCatalog?: string[];
  fetchDeviceReport: (encId: string, fecha: string) => Promise<{ base64: string; error?: string }>;
  extractDeviceItems: (base64: string) => Promise<DeviceTextItem[]>;
  fetchHistoryScales: (encId: string) => Promise<{
    events: RayenHistoryScaleEvent[];
    nursingActivity?: RayenNursingActivity[];
    error?: string;
  }>;
  fetchScalesForms: (encId: string) => Promise<{ forms: unknown[]; error?: string }>;
  fetchCudyrCategories: () => Promise<{ items: RayenCudyrCategory[]; error?: string }>;
  applyHistoricalCudyr?: (
    encId: string,
    censusDay: string,
    cudyr: ImportedCudyr
  ) => Promise<HistoricalCudyrApplyResult>;
  applyPatch: (patch: DailyRecordPatch, target: ClinicalFillPatchTarget) => Promise<void>;
  /** Optional request-scoped atomic persistence. Omit to preserve the established per-patient path. */
  applyBatch?: (operations: ClinicalFillPatchOperation[]) => Promise<ClinicalFillBatchApplyResult>;
  /** Optional shadow observer; never owns or delays the established per-patient persistence. */
  observeBatch?: (operations: ClinicalFillPatchOperation[]) => Promise<void>;
  now: () => Date;
  createId: () => string;
  monotonicNow?: () => number;
}

export interface ClinicalFillPatchOperation {
  patch: DailyRecordPatch;
  target: ClinicalFillPatchTarget;
}

export interface ClinicalFillBatchApplyResult {
  patientWrites: number;
  historySnapshots: number;
  retries?: number;
  failures?: ClinicalFillBatchApplyFailure[];
}

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

export interface ClinicalFillError {
  bedId: string;
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
  };
  performance?: RayenSyncPerformance;
}

export interface ClinicalFillProgress {
  done: number;
  total: number;
}
