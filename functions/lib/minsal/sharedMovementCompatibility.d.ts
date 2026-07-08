export interface ReportingMovementSnapshot {
  clinicalEpisodeId?: string;
  rut?: string;
  specialty?: string;
  admissionDate?: string;
  diagnosis?: string;
  originalData?: {
    specialty?: string;
    admissionDate?: string;
    pathology?: string;
  };
}

export function normalizeMovementReportingSnapshot<T extends ReportingMovementSnapshot>(
  movement: T
): T & {
  specialty?: string;
  admissionDate?: string;
  diagnosis?: string;
};
