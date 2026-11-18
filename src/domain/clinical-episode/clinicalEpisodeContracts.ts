export interface PatientEpisodeContract {
  /** Stable server/client episode identifier. Falls back to the legacy tuple while adoption ramps up. */
  clinicalEpisodeId?: string;
  rut?: string;
  patientName?: string;
  admissionDate?: string;
  /** First day observed in census for the current episode, when available. */
  firstSeenDate?: string;
  admissionTime?: string;
  specialty?: string;
}
