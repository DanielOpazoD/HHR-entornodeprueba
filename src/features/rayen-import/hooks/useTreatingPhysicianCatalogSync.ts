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
      // The mutation replaces the complete shared catalog. Never derive that replacement from the
      // query's transient empty value while its authoritative read is still pending or has failed.
      if (!catalogLoaded || !professionalsCatalog) return snapshot;
      const merged = mergeDiscoveredTreatingPhysicians(
        professionalsCatalog,
        snapshot.physicians ?? []
      );
      if (merged.changed) saveProfessionals(merged.catalog);
      return enrichSnapshotWithTreatingPhysicianSpecialties(snapshot, merged.catalog);
    },
    [catalogLoaded, professionalsCatalog, saveProfessionals]
  );
};
