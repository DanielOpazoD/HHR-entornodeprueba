import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import {
  findProfessionalByRayenIdentity,
  professionalSpecialtyToPatientSpecialty,
} from '@/services/staff/treatingPhysicianCatalog';
import type { RayenCensusSnapshot } from '../contracts/rayenSnapshot';

/** Restores physician display names and adds configured specialties to a planning snapshot. */
export const enrichSnapshotWithTreatingPhysicianSpecialties = (
  snapshot: RayenCensusSnapshot,
  catalog: ProfessionalCatalogItem[]
): RayenCensusSnapshot => {
  if (catalog.length === 0) return snapshot;
  let changed = false;
  const encounters = snapshot.encounters.map(encounter => {
    const entry = findProfessionalByRayenIdentity(
      catalog,
      encounter.treatingPhysicianId,
      encounter.treatingPhysicianName
    );
    const name = encounter.treatingPhysicianName?.trim() || entry?.name.trim();
    const specialty = professionalSpecialtyToPatientSpecialty(entry?.specialty);
    if (
      (!name || name === encounter.treatingPhysicianName) &&
      (!specialty || specialty === encounter.treatingPhysicianSpecialty)
    ) {
      return encounter;
    }
    changed = true;
    return {
      ...encounter,
      treatingPhysicianName: name || encounter.treatingPhysicianName,
      treatingPhysicianSpecialty: specialty || encounter.treatingPhysicianSpecialty,
    };
  });
  return changed ? { ...snapshot, encounters } : snapshot;
};
