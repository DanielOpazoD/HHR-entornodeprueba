export interface SpecialistHandoffTarget {
  bedId: string;
  target: 'bed' | 'clinicalCrib';
  clinicalEpisodeId: string;
  rut: string;
  documentType: string;
  patientName: string;
}
