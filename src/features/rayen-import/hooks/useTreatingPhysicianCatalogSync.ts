import { useCallback } from 'react';
import { useProfessionalsQuery, useSaveProfessionalsMutation } from '@/hooks/useStaffQuery';
import { enrichSnapshotWithTreatingPhysicianSpecialties } from '../domain/enrichTreatingPhysicianSnapshot';
import { mergeDiscoveredTreatingPhysicians } from '@/services/staff/treatingPhysicianCatalog';
import type { RayenCensusSnapshot } from '../contracts/rayenSnapshot';

/** Discovers Rayen physicians and enriches imports with HHR's curated specialty mapping. */
export const useTreatingPhysicianCatalogSync = () => {
  const { data: professionalsCatalog, isSuccess: catalogLoaded } = useProfessionalsQuery();
  const { mutate: saveProfessionals } = useSaveProfessionalsMutation();

  return useCallback(
    (snapshot: RayenCensusSnapshot): RayenCensusSnapshot => {
      // Changes require the loaded catalog as their base; a failed read never supplies an empty base.
      if (!catalogLoaded || !professionalsCatalog) return snapshot;
      const merged = mergeDiscoveredTreatingPhysicians(
        professionalsCatalog,
        snapshot.physicians ?? []
      );
      if (merged.changed) saveProfessionals({ next: merged.catalog, base: professionalsCatalog });
      return enrichSnapshotWithTreatingPhysicianSpecialties(snapshot, merged.catalog);
    },
    [catalogLoaded, professionalsCatalog, saveProfessionals]
  );
};
