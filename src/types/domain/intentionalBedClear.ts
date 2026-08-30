export interface ConfirmedBedOccupantIdentity {
  /** Confirms an existing crib whose occupant has not received identifying data yet. */
  presenceOnly?: true;
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
  /**
   * Snapshot of the attached clinical crib when the parent-bed clear was confirmed.
   * `null` means that no crib existed; `undefined` is reserved for legacy callers.
   */
  confirmedAssociatedCrib?: ConfirmedBedOccupantIdentity | null;
}

export interface ClinicalCribCreateRequest {
  bedId: string;
  confirmedLastUpdated: string;
  confirmedParent: ConfirmedBedOccupantIdentity;
}
