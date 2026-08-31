import type { BedDefinition, BedType } from '@/features/census/contracts/censusBedContracts';
import type { PatientData } from '@/features/census/types/censusTablePatientContracts';

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
