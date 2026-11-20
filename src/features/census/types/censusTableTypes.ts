import type { PatientData } from '@/types/domain/patient';

import type { BedDefinition } from '@/types/domain/beds';
import type { BedType } from '@/types/domain/beds';

export type DiagnosisMode = 'free' | 'cie10';

export type UnifiedBedRow =
  | {
      kind: 'occupied';
      id: string;
      bed: BedDefinition;
      data: PatientData;
      isSubRow: boolean;
      /** Provisional crib row projected from a pending guarded creation; read-only until the ACK. */
      isPendingCreate?: boolean;
      /** On a crib row: its mother's accredited episode, so a new mother mounts a new crib row. */
      saveScopeOwner?: string;
    }
  | { kind: 'empty'; id: string; bed: BedDefinition };

export interface CensusBedRows {
  unifiedRows: UnifiedBedRow[];
  emptyBedCount: number;
}

export type BedTypesById = Record<string, BedType>;
