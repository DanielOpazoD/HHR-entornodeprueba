import type { CensusMovementActionDescriptor } from '@/features/census/types/censusMovementActionTypes';

export interface CensusMovementRowBaseViewModel {
  id: string;
  bedName: string;
  bedType: string;
  patientName: string;
  rut: string;
  diagnosis: string;
  movementDate?: string;
  movementTime?: string;
  actions: CensusMovementActionDescriptor[];
}

export interface DischargeRowViewModel extends CensusMovementRowBaseViewModel {
  kind: 'discharge';
  dischargeTypeLabel: string;
  statusLabel: string;
  statusBadgeClassName: string;
}

export interface TransferRowViewModel extends CensusMovementRowBaseViewModel {
  kind: 'transfer';
  evacuationMethodLabel: string;
  receivingCenterLabel: string;
  transferEscortLabel: string | null;
}
