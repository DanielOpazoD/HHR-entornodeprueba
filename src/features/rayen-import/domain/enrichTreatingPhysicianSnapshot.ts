import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import {
  findProfessionalByRayenIdentity,
  professionalSpecialtyToPatientSpecialty,
} from '@/services/staff/treatingPhysicianCatalog';
import type { RayenCensusSnapshot } from '../contracts/rayenSnapshot';

/** Adds configured HHR specialties to an ephemeral planning snapshot. */
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
    const specialty = professionalSpecialtyToPatientSpecialty(entry?.specialty);
    if (!specialty || specialty === encounter.treatingPhysicianSpecialty) return encounter;
    changed = true;
    return { ...encounter, treatingPhysicianSpecialty: specialty };
  });
  return changed ? { ...snapshot, encounters } : snapshot;
};
