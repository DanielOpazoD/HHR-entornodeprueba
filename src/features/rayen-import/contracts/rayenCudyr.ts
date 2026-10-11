import type { CudyrSourcePlacement } from '@/types/domain/cudyrPlacement';

export interface RayenCudyrHistoryEntry {
  id?: string;
  category: string;
  recordedAt: string;
  author?: string;
  authorId?: string;
  authorRoleId?: string;
  authorRole?: string;
  sourceVersion?: string;
  isDeleted?: boolean;
  dependencyScore?: number | null;
  riskScore?: number | null;
  items?: Array<{ fieldId: string; label: string; typeId: number; value: string }>;
}

/** One patient's official CUDYR history, with a Ficha Médico latest-value fallback. */
export interface RayenCudyrCategory {
  encId: string;
  crdValue: string;
  crdDateTime: string;
  author?: string;
  authorRole?: string;
  source?: 'gestion_camas' | 'ficha_medico';
  history?: RayenCudyrHistoryEntry[];
  /** Includes source tombstones; never used as the current clinical result. */
  observations?: RayenCudyrHistoryEntry[];
  metadataComplete?: boolean;
  sourcePlacements?: CudyrSourcePlacement[];
}

export type RayenCudyrSource = 'gestion_camas' | 'gestion_camas+ficha_medico' | 'ficha_medico';

/** Provenance and authority returned by the extension's single shared CUDYR capture. */
export interface RayenCudyrCategoriesResponse {
  items: RayenCudyrCategory[];
  source?: RayenCudyrSource;
  /** True only when Gestión de Camas supplied the official per-episode history. */
  historyAvailable?: boolean;
  captureContract?: 1;
  observedEpisodeIds?: string[];
  metadataStatus?: 'complete' | 'partial';
  warning?: string;
  error?: string;
}
