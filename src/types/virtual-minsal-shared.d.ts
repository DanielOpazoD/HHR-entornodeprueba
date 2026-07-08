declare module 'virtual:minsal-shared-episode-tracker' {
  export interface EpisodeObservedPatient {
    clinicalEpisodeId?: string;
    patientName?: string;
    rut?: string;
    admissionDate?: string;
    isBlocked?: boolean;
    clinicalCrib?: EpisodeObservedPatient;
  }

  export interface EpisodeAdmissionTracker {
    observeBed: (bed: EpisodeObservedPatient | undefined, recordDate: string) => void;
    resolveAdmissionDate: (
      patientOrRut?: EpisodeObservedPatient | string,
      fallbackAdmissionDate?: string
    ) => string | undefined;
    resolveEpisodeStartDate: (
      patientOrRut?: EpisodeObservedPatient | string,
      fallbackAdmissionDate?: string
    ) => string | undefined;
    closeEpisode: (patientOrRut?: EpisodeObservedPatient | string) => void;
  }

  export function createEpisodeAdmissionTracker(): EpisodeAdmissionTracker;
}

declare module 'virtual:minsal-shared-movement-compatibility' {
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
}
