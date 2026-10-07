import type { CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';
/** A verified physical departure, kept separate from source egreso and medical epicrisis. */
export interface CudyrActualDischarge {
  date: string;
  /** Absence means unknown precision, never midnight. */
  time?: string;
  timeZone: typeof CLINICAL_TIME_ZONE;
}

export interface CorrectCudyrDischargeRequest {
  kind: 'correct-discharge';
  schemaVersion: 1;
  operationId: string;
  authorityDate: string;
  clinicalEpisodeId: string;
  expectedRevision: number;
  actualDischarge: CudyrActualDischarge | null;
  reason: string;
  confirmed: true;
}

export interface CudyrDischargeCorrection {
  schemaVersion: 1;
  clinicalEpisodeId: string;
  revision: number;
  operationId: string;
  actualDischarge: CudyrActualDischarge | null;
  reason: string;
  authorityDate: string;
  admissionDate: string;
  sourceContexts: CudyrDischargeSourceContext[];
  updatedAt: string;
  updatedBy: { uid: string; email: string; name: string; role: string };
}

export interface CudyrDischargeAudit extends CudyrDischargeCorrection {
  id: string;
  previousRevision: number;
  previousDischarge: CudyrActualDischarge | null;
}

export interface CorrectCudyrDischargeResult {
  success: true;
  persisted: true;
  correction: CudyrDischargeCorrection;
}

export interface ReadCudyrDischargesRequest {
  kind: 'discharge-corrections';
  clinicalEpisodeIds: string[];
}
export interface ReadCudyrDischargesResult {
  corrections: CudyrDischargeCorrection[];
}
export interface ReadCudyrDischargeAuditRequest {
  kind: 'discharge-audit';
  clinicalEpisodeId: string;
  limit?: number;
  cursor?: string;
}
export interface ReadCudyrDischargeAuditResult {
  entries: CudyrDischargeAudit[];
  nextCursor: string | null;
}

export interface CudyrDischargeSourceContext {
  section: string;
  bedId: string;
  movementId?: string;
  movementDate?: string;
  movementTime?: string;
  movementRecordedAt?: string;
  movementSource?: string;
  epicrisisRegisteredAt?: string;
}
