export interface ConfirmedBedOccupantIdentity {
  clinicalEpisodeId?: string;
  rut?: string;
  patientName?: string;
  firstSeenDate?: string;
  admissionDate?: string;
  admissionTime?: string;
}

export interface IntentionalBedClearRequest {
  bedId: string;
  target?: 'bed' | 'clinicalCrib';
  confirmedLastUpdated: string;
  confirmedOccupant: ConfirmedBedOccupantIdentity;
}
