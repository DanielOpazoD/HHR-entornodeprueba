export interface ClinicalDocumentEpisodeContext {
  patientRut: string;
  patientName: string;
  episodeKey: string;
  documentLookupEpisodeKeys?: string[];
  admissionDate?: string;
  admissionTime?: string;
  sourceDailyRecordDate?: string;
  sourceBedId?: string;
  specialty?: string;
}
