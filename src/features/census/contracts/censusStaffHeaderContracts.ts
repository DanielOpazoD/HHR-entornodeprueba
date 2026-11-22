export interface CensusHeaderPatientContract {
  patientName?: string;
  isBlocked?: boolean;
  admissionDate?: string;
  admissionTime?: string;
  clinicalCrib?: CensusHeaderPatientContract;
}
