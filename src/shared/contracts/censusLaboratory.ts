/** Identity and display context for laboratory work captured from one census. */
export interface CensusLabPatient {
  rutBody: string;
  episodeId: string;
  admissionDate: string;
  patientName: string;
  bedLabel: string;
}

/** Calendar days, both included; an explicit query window, independent of the census day. */
export interface CensusLabDateRange {
  from: string;
  to: string;
}
