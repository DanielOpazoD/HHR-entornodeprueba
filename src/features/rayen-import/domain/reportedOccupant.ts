import {
  findOccupiedBed,
  findOccupiedClinicalCrib,
  type OccupiedBedEvidence,
  type OccupiedClinicalCrib,
} from './egresoReportPolicy';

/**
 * Ocupante de cama principal al que apunta una fila del informe o del lookup.
 *
 * `findOccupiedBed` cae al RUN cuando el episodio no está entre las camas
 * principales. Con un RN registrado bajo el RUN de la madre, la fila del RN
 * (episodio exacto de la CUNA) resolvía la cama de la madre y el pipeline
 * construía un SEGUNDO egreso de la madre en la misma cama (alta duplicada en
 * la estadística) mientras el RN quedaba sin egreso. Si el episodio exacto de la
 * fila pertenece a una cuna ocupada, la fila es de la cuna, no de la cama.
 */
export const resolveReportedOccupant = (
  occupied: ReadonlyMap<string, OccupiedBedEvidence>,
  occupiedCribs: ReadonlyMap<string, OccupiedClinicalCrib>,
  run: string | undefined,
  episodeId: string | undefined
): OccupiedBedEvidence | undefined => {
  const reportedEpisode = String(episodeId ?? '').trim();
  const cribByEpisode = reportedEpisode
    ? findOccupiedClinicalCrib(occupiedCribs, undefined, reportedEpisode)
    : undefined;
  // Una cama principal con ESE episodio exacto (RN ya promovido a cama propia) gana
  // sobre una cuna rancia con el mismo episodio bajo la cama de la madre.
  return (
    (reportedEpisode ? occupied.get(`episode:${reportedEpisode}`) : undefined) ??
    (cribByEpisode ? undefined : findOccupiedBed(occupied, run, reportedEpisode || undefined))
  );
};
