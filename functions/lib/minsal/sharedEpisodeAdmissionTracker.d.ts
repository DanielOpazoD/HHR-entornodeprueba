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
