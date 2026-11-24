interface UpcRoundSubject {
  patientName?: string;
  clinicalEpisodeId?: string;
  rut?: string;
  firstSeenDate?: string;
  admissionDate?: string;
  admissionTime?: string;
}

/** A draft belongs to the occupant and admission, including on older censuses without an episode ID. */
export const resolveUpcEpisodeIdentity = (subject?: UpcRoundSubject | null): string | null => {
  const name = subject?.patientName?.trim();
  if (!name) return null;
  const episode = subject?.clinicalEpisodeId?.trim();
  if (episode && !episode.startsWith('legacy_ep_')) return episode;
  return JSON.stringify([
    episode,
    subject?.rut?.trim(),
    name,
    subject?.firstSeenDate || subject?.admissionDate,
    subject?.admissionTime,
  ]);
};
