import type { CensusMovementActionDescriptor } from '@/features/census/types/censusMovementActionTypes';
import type { MovementProvenance } from '@/types/domain/movements';

export interface CensusMovementRowBaseViewModel {
  id: string;
  bedName: string;
  bedType: string;
  patientName: string;
  rut: string;
  diagnosis: string;
  movementDate?: string;
  movementTime?: string;
  movementProvenance?: MovementProvenance;
  actions: CensusMovementActionDescriptor[];
}

export interface DischargeRowViewModel extends CensusMovementRowBaseViewModel {
  kind: 'discharge';
  isAssociatedClinicalCrib?: boolean;
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
