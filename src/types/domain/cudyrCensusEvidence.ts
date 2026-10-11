export interface CudyrCensusSource {
  date: string;
  patients: Array<{ name: string; discharged: boolean; transferred: boolean; deceased: boolean }>;
}
export interface ArchivedCudyrCensus {
  id: string;
  date: string;
  source: CudyrCensusSource;
  observedAt: string;
  importedAt: string;
}
