interface PhysicianFields {
  clinicalEpisodeId?: string;
  treatingPhysicianId?: string;
  treatingPhysicianName?: string;
  dismissedTreatingPhysician?: {
    episodeId: string;
    practitionerId?: string;
    name?: string;
    displayName?: string;
  };
}

const normalizedName = (name?: string): string =>
  (name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es-CL');

/** A durable dismissal requires Rayen's stable clinical episode ID. */
export const dismissTreatingPhysician = (
  patient: PhysicianFields,
  resolved?: { practitionerId?: string; name?: string }
): Pick<
  PhysicianFields,
  'treatingPhysicianId' | 'treatingPhysicianName' | 'dismissedTreatingPhysician'
> => {
  const episodeId = patient.clinicalEpisodeId?.trim();
  return {
    treatingPhysicianId: undefined,
    treatingPhysicianName: undefined,
    ...(episodeId
      ? {
          dismissedTreatingPhysician: {
            episodeId,
            practitionerId:
              patient.treatingPhysicianId?.trim() || resolved?.practitionerId?.trim() || undefined,
            name: patient.treatingPhysicianName?.trim() || resolved?.name?.trim() || undefined,
            displayName: resolved?.name?.trim() || undefined,
          },
        }
      : {}),
  };
};

export const isDismissedTreatingPhysician = (
  current: PhysicianFields,
  incoming: PhysicianFields
): boolean => {
  const dismissed = current.dismissedTreatingPhysician;
  const episodeId = dismissed?.episodeId?.trim();
  if (
    !dismissed ||
    !episodeId ||
    current.clinicalEpisodeId?.trim() !== episodeId ||
    incoming.clinicalEpisodeId?.trim() !== episodeId
  )
    return false;

  const incomingId = incoming.treatingPhysicianId?.trim();
  const dismissedId = dismissed.practitionerId?.trim();
  if (incomingId && dismissedId) return incomingId === dismissedId;
  const incomingName = normalizedName(incoming.treatingPhysicianName);
  return Boolean(
    incomingName &&
    (incomingName === normalizedName(dismissed.name) ||
      incomingName === normalizedName(dismissed.displayName))
  );
};
