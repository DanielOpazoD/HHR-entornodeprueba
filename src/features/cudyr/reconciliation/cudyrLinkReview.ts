import type { CudyrComparisonItem } from '@/types/domain/cudyrReconciliation';
import type { CudyrReportRow } from '@/types/domain/cudyrReport';

/** Session-only deliberation. This is not an accepted clinical link or an audit record. */
export interface CudyrLinkDraft {
  action: 'link' | 'exclude' | 'pending';
  episodeId: string;
  reason: string;
}
export const CUDYR_LINK_LABELS = {
  link: 'Vínculo propuesto',
  exclude: 'Descartado del cotejo',
  pending: 'Pendiente con observación',
};
const documentKey = (value: string) => value.replace(/[.\s-]/g, '').toUpperCase();
const nameKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
export const isReviewableCudyrSource = (item: CudyrComparisonItem) =>
  /^(category|discharge):/.test(item.key) && Boolean(item.sourceRow);

/** Show every episode for the document in this read, including re-admissions and shared RN IDs. */
export const cudyrLinkCandidates = (item: CudyrComparisonItem, rows: CudyrReportRow[]) => {
  if (!isReviewableCudyrSource(item) || !documentKey(item.document)) return [];
  const ids = new Set(
    rows
      .filter(r => documentKey(r.rut) === documentKey(item.document))
      .map(r => r.clinicalEpisodeId)
  );
  return [...ids]
    .filter(Boolean)
    .sort()
    .flatMap(episodeId => {
      const context = rows
        .filter(r => r.clinicalEpisodeId === episodeId)
        .sort((a, b) => a.date.localeCompare(b.date));
      // An internally inconsistent episode cannot be resolved by selecting it in this panel.
      if (
        context.some(
          r => documentKey(r.rut) !== documentKey(item.document) || !nameKey(r.patientName)
        ) ||
        new Set(context.map(r => nameKey(r.patientName))).size !== 1
      )
        return [];
      return [{ episodeId, rows: context }];
    });
};

export const validateCudyrLinkDraft = (
  item: CudyrComparisonItem,
  rows: CudyrReportRow[],
  draft: CudyrLinkDraft,
  acknowledged: boolean
): string => {
  if (!isReviewableCudyrSource(item)) return 'Solo se revisan filas de informes Eloísa.';
  if (!Object.hasOwn(CUDYR_LINK_LABELS, draft.action)) return 'Seleccione una decisión válida.';
  if (draft.reason.trim().length < 10 || draft.reason.trim().length > 1000)
    return 'Describa el motivo y respaldo de la decisión (10 a 1000 caracteres).';
  if (draft.action !== 'link') return '';
  if (!cudyrLinkCandidates(item, rows).some(c => c.episodeId === draft.episodeId))
    return 'Seleccione un episodio disponible y consistente en esta lectura.';
  if (!acknowledged) return 'Confirme la revisión de identidad, episodio y fechas.';
  return '';
};
