import type { ClinicalFillError } from '../contracts/clinicalFillContracts';
import type { ClinicalReadSelection, ClinicalReadSource } from '../contracts/clinicalReadSelection';

const readsForIssue = (
  source: ClinicalFillError['source']
): readonly ClinicalReadSource[] | undefined => {
  switch (source) {
    case 'devices':
      return ['devices'];
    case 'vitals':
      return ['forms'];
    case 'scales':
      return ['history', 'forms'];
    case 'staffing':
      return ['history'];
    case 'cudyr':
      return ['cudyr'];
    default:
      return undefined;
  }
};

/** Unknown or persistence failures require full evidence; never infer reads from error text. */
export const selectClinicalRetryReads = (
  candidates: readonly { bedId: string; patient: { clinicalEpisodeId?: string } }[],
  errors: readonly ClinicalFillError[]
): ClinicalReadSelection | undefined => {
  if (
    !errors.length ||
    errors.some(
      error => error.bedId === '*' && error.source !== 'cudyr' && error.source !== 'staffing'
    )
  ) {
    return undefined;
  }
  const selection: Record<string, readonly ClinicalReadSource[]> = {};
  for (const { bedId, patient } of candidates) {
    const episodeId = patient.clinicalEpisodeId;
    if (!episodeId) continue;
    const relevant = errors.filter(
      error =>
        error.bedId === '*' ||
        (error.clinicalEpisodeId ? error.clinicalEpisodeId === episodeId : error.bedId === bedId)
    );
    const reads = relevant.map(error => readsForIssue(error.source));
    if (!reads.length || reads.some(value => !value)) continue;
    selection[episodeId] = [...new Set(reads.flatMap(value => value ?? []))];
  }
  return Object.keys(selection).length ? selection : undefined;
};
