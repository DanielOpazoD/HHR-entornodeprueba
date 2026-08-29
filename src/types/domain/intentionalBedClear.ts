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
  confirmedLastUpdated: string;
  confirmedOccupant: ConfirmedBedOccupantIdentity;
}
