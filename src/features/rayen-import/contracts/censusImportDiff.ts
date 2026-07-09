/**
 * Output contract for the Rayen → HHR census import.
 *
 * `reconcileCensus` produces a `CensusImportDiff` describing what *would* change
 * if the snapshot were applied. Phase 1 only computes and previews this diff;
 * it does not persist anything.
 */

import type { PatientData } from '@/types/domain/patient';
import type { RayenEncounter } from './rayenSnapshot';
import type { DischargeKind } from '../mapping/dischargeMapping';

/** A single field that differs between the current census patient and the Rayen data. */
export interface FieldChange {
  field: keyof PatientData;
  from: unknown;
  to: unknown;
}

/** A patient present in Rayen but not yet in the HHR census → will be admitted to a bed. */
export interface AdmissionEntry {
  bedId: string;
  patient: PatientData;
  isCma: boolean;
  source: RayenEncounter;
}

/** A matched patient in the same bed whose Rayen-sourced fields changed. */
export interface UpdateEntry {
  bedId: string;
  rut: string;
  patientName: string;
  changes: FieldChange[];
  patient: PatientData;
  source: RayenEncounter;
}

/**
 * A matched patient whose Rayen bed differs from the HHR bed → relocated within the
 * census. This is a bed *move*, NOT a hospital transfer (hospital transfers are a
 * discharge kind — see `DischargeEntry`).
 */
export interface MoveEntry {
  fromBedId: string;
  toBedId: string;
  rut: string;
  patientName: string;
  source: RayenEncounter;
}

/** A patient leaving the census (discharged in Rayen, or absent from the snapshot). */
export interface DischargeEntry {
  bedId: string;
  rut: string;
  patientName: string;
  kind: DischargeKind;
  status: 'Vivo' | 'Fallecido';
  reason: 'rayen-discharge' | 'missing-in-rayen';
  source?: RayenEncounter;
}

/** Something that cannot be applied automatically and needs human resolution. */
export interface ConflictEntry {
  bedId: string | null;
  rut?: string;
  patientName?: string;
  reason: string;
  source?: RayenEncounter;
}

export interface CensusImportSummary {
  admissions: number;
  updates: number;
  moves: number;
  discharges: number;
  conflicts: number;
  unchanged: number;
}

export interface CensusImportDiff {
  admissions: AdmissionEntry[];
  updates: UpdateEntry[];
  moves: MoveEntry[];
  discharges: DischargeEntry[];
  conflicts: ConflictEntry[];
  unchangedCount: number;
  summary: CensusImportSummary;
}
