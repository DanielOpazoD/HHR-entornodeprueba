/** Preserve the source bed interval without confusing stale nested mappings with occupancy. */
(function (root) {
  'use strict';
  const text = value => String(value == null ? '' : value).trim();
  const fold = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const modality = (bed, parentBedId, bedId) => {
    if (parentBedId) return 'cuna';
    const label = fold([bed.name, bed.shortName, bed.hospitalDepartmentName].join(' / '));
    if (/(?:^|[^A-Z])CMA/.test(label) ||
      label.includes('QUIRURGICA INDIFERENCIADA') && !label.includes('MEDICO')) return 'cma';
    return bedId ? 'hospitalizacion' : 'desconocida';
  };
  const buildPlacements = beds => {
    const placements = [];
    for (const bed of Array.isArray(beds) ? beds : []) {
      const mapping = bed && bed.bedEncounterMapping;
      const encounter = mapping && mapping.encounterMapping && mapping.encounterMapping.encounter;
      const clinicalEpisodeId = text(encounter && encounter.id);
      if (!clinicalEpisodeId || clinicalEpisodeId === '0') continue;
      const parentBedId = root.HhrGestionCamasClinicalCribs.parentBedIdFromRecord(bed);
      const bedId = parentBedId || root.HhrGestionCamasActiveBeds.bedIdFromLabel(bed.shortName) ||
        root.HhrGestionCamasActiveBeds.bedIdFromLabel(bed.name) || '';
      const isDeleted = bed.isDeleted === true || mapping.isDeleted === true;
      placements.push({
        clinicalEpisodeId,
        sourceMappingId: text(mapping.id), sourceBedId: text(bed.id),
        sourceBedLabel: text(bed.shortName || bed.name),
        sourceDepartmentId: text(mapping.hospitalDepartmentId || bed.hospitalDepartmentId),
        sourceDepartmentLabel: text(bed.hospitalDepartmentName),
        sourceVersion: text(mapping.timeStamp),
        sourceStartAt: text(mapping.startDateTime), sourceEndAt: text(mapping.endDateTime),
        currentAssignment: !isDeleted && text(bed.encounterId) === clinicalEpisodeId,
        isDeleted, bedId, modality: modality(bed, parentBedId, bedId),
      });
    }
    return [...new Map(placements.map(value => [JSON.stringify(value), value])).values()];
  };
  root.HhrCudyrPlacementSupport = Object.freeze({ buildPlacements });
})(typeof self !== 'undefined' ? self : globalThis);
