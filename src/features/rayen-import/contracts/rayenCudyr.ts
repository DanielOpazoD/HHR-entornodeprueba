export interface RayenCudyrHistoryEntry {
  id?: string;
  category: string;
  recordedAt: string;
  author?: string;
  authorRole?: string;
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
}

export type RayenCudyrSource = 'gestion_camas' | 'gestion_camas+ficha_medico' | 'ficha_medico';

/** Provenance and authority returned by the extension's single shared CUDYR capture. */
export interface RayenCudyrCategoriesResponse {
  items: RayenCudyrCategory[];
  source?: RayenCudyrSource;
  /** True only when Gestión de Camas supplied the official per-episode history. */
  historyAvailable?: boolean;
  warning?: string;
  error?: string;
}
