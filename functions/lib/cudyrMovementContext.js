/** Explicit movement timestamps and epicrisis evidence have different clinical meanings. */
const movementContext = movement => {
  const values = {
    movementId: movement.id,
    movementDate: movement.movementDate,
    movementTime: movement.time || movement.dischargeTime,
    movementRecordedAt: movement.movementProvenance?.classifiedAt || movement.timestamp,
    movementSource: movement.movementProvenance?.source,
    movementRunId: movement.movementProvenance?.syncRunId,
    movementLineageId: movement.movementProvenance?.lineageId,
  };
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => typeof value === 'string')
  );
};

const epicrisisContext = patient => {
  const value = patient.dischargeVerification;
  if (!value || value.encounterId !== patient.clinicalEpisodeId) return {};
  return Object.fromEntries(
    Object.entries({
      medicalEpicrisisStatus: value.medicalEpicrisis,
      nursingEpicrisisStatus: value.nursingEpicrisis,
      epicrisisRegisteredAt: value.registeredAt,
    }).filter(([, entry]) => typeof entry === 'string')
  );
};
module.exports = { movementContext, epicrisisContext };
