import type { CudyrReportDataset, CudyrReportRow } from '@/types/domain/cudyrReport';

export type CudyrRecoveryNeed = 'identity' | 'eligibility' | 'evaluation' | 'metadata';
export const CUDYR_RECOVERY_LABELS = {
  identity: 'Confirmar identidad y episodio',
  eligibility: 'Confirmar modalidad de ese día',
  evaluation: 'Buscar evaluación no observada',
  metadata: 'Completar autor o fecha de aplicación',
};
export interface CudyrRecoveryCase {
  key: string;
  episodeId: string;
  patientName: string;
  document: string;
  canOpenEpisode: boolean;
  needs: CudyrRecoveryNeed[];
  rows: Array<{ row: CudyrReportRow; needs: CudyrRecoveryNeed[] }>;
}
const documentKey = (v: string) => v.replace(/[.\s-]/g, '').toUpperCase();
const nameKey = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();

/** A worklist, not a compliance denominator or an inferred source application. */
export const buildCudyrRecoveryPlan = (data: CudyrReportDataset): CudyrRecoveryCase[] => {
  const cases = new Map<string, CudyrRecoveryCase>();
  for (const row of data.rows) {
    if (row.eligibility === 'no_elegible') continue;
    const episodeId = row.clinicalEpisodeId.trim();
    const sameEpisode = episodeId
      ? data.rows.filter(r => r.clinicalEpisodeId.trim() === episodeId)
      : [];
    const consistent =
      Boolean(episodeId && documentKey(row.rut) && nameKey(row.patientName)) &&
      sameEpisode.every(
        r =>
          documentKey(r.rut) === documentKey(row.rut) &&
          nameKey(r.patientName) === nameKey(row.patientName)
      );
    const needs: CudyrRecoveryNeed[] = [];
    if (!consistent) needs.push('identity');
    if (row.eligibility === 'por_revisar') needs.push('eligibility');
    // Resolve eligibility first. A blank on a possibly excluded day is not a CUDYR gap.
    if (row.eligibility === 'elegible') {
      if (!row.evaluation) needs.push('evaluation');
      else if (!row.evaluation.author?.trim() || !row.evaluation.recordedAt?.trim())
        needs.push('metadata');
    }
    if (!needs.length) continue;
    // Unknown episodes remain distinct daily rows; shared RN documents never merge episodes.
    const key = JSON.stringify([
      episodeId || row.key,
      documentKey(row.rut),
      nameKey(row.patientName),
    ]);
    const entry = cases.get(key) || {
      key,
      episodeId,
      patientName: row.patientName,
      document: row.rut,
      canOpenEpisode: consistent,
      needs: [],
      rows: [],
    };
    entry.rows.push({ row, needs });
    entry.needs = [...new Set([...entry.needs, ...needs])];
    cases.set(key, entry);
  }
  return [...cases.values()].map(entry => ({
    ...entry,
    rows: entry.rows.sort((a, b) => a.row.date.localeCompare(b.row.date)),
  }));
};
export const cudyrRecoveryGuidance = (entry: CudyrRecoveryCase) => {
  if (entry.needs.includes('identity'))
    return 'Confirmar identidad y episodio antes de buscar o vincular aplicaciones. El RUT no basta.';
  if (entry.needs.includes('eligibility'))
    return 'Revisar censo y movimientos del día. La cama al egreso no acredita la modalidad de días previos.';
  if (entry.rows.every(({ row }) => row.evaluation?.source.includes('manual')))
    return 'Consultar el respaldo manual HHR y su trazabilidad. No sustituirlo por una categoría posterior de Eloísa.';
  return 'Cotejar la aplicación original de este episodio: ID, categoría, autor y fecha con desfase. Un informe vacío o los últimos tres registros no prueban que nunca se aplicó.';
};
