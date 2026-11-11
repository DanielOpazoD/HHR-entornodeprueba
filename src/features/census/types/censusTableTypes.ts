import type { PatientData } from '@/types/domain/patient';

import type { BedDefinition } from '@/types/domain/beds';
import type { BedType } from '@/features/census/contracts/censusBedContracts';

export type DiagnosisMode = 'free' | 'cie10';

export interface OccupiedBedRow {
  id: string;
  bed: BedDefinition;
  data: PatientData;
  isSubRow: boolean;
}

export type UnifiedBedRow =
  | {
      kind: 'occupied';
      id: string;
      bed: BedDefinition;
      data: PatientData;
      isSubRow: boolean;
      /** Provisional crib row projected from a pending guarded creation; read-only until the ACK. */
      isPendingCreate?: boolean;
    }
  | { kind: 'empty'; id: string; bed: BedDefinition };

export interface CensusBedRows {
  unifiedRows: UnifiedBedRow[];
  emptyBedCount: number;
}

export type BedTypesById = Record<string, BedType>;
