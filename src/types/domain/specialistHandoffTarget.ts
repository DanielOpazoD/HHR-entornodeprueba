export interface SpecialistHandoffTarget {
  bedId: string;
  target: 'bed' | 'clinicalCrib';
  clinicalEpisodeId: string;
  rut: string;
  documentType: string;
  patientName: string;
  /**
   * Stored note texts this write may replace: the one the edit started from, plus texts this
   * device already sent for the same note. Any other stored text is someone else's.
   */
  handoffBases?: string[];
}
