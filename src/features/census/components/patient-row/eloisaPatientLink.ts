/** The page nurses open for a patient in Eloísa: the episode in Ficha Médico's nurse list. */
export const buildEloisaNurseEncounterUrl = (episode: string): string =>
  `https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse/${encodeURIComponent(episode)}`;
