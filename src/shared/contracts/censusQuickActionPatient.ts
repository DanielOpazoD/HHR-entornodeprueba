/**
 * A census patient offered to the date-strip quick actions (MMRAD, Lab, clinical library):
 * only what those actions read.
 */
export interface CensusQuickActionPatient {
  bedId: string;
  label: string;
  patientName: string;
  rut: string;
  diagnosis: string;
  age: string;
  birthDate: string;
  admissionDate: string;
  clinicalEpisodeId?: string;
}
