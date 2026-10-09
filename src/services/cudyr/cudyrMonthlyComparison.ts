import { createCudyrIdentityResolver } from './cudyrNameReconciliation';
import type { CudyrReportDataset, CudyrReportRow } from '@/types/domain/cudyrReport';
import type { CudyrSupplementReport } from '@/types/domain/cudyrSupplement';
import type {
  CudyrComparisonItem,
  CudyrComparisonStatus,
  CudyrDischargeReport,
} from '@/types/domain/cudyrReconciliation';

export const CUDYR_COMPARISON_LABELS: Record<CudyrComparisonStatus, string> = {
  compatible: 'Coincidencia documental',
  category_difference: 'Categoría diferente',
  date_review: 'Fecha por cotejar',
  identity_review: 'Identidad por revisar',
  no_hhr_candidate: 'Sin candidato en HHR',
  no_hhr_result: 'Sin resultado HHR para cotejar',
  discharge_review: 'Alta por cotejar',
  hhr_only: 'HHR sin contraparte cotejada',
};
const documentKey = (v: string) => v.replace(/[.\s-]/g, '').toUpperCase();
const sourceDate = (r: CudyrReportRow) => {
  const at = r.evaluation?.recordedAt || '';
  return /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(at) && Number.isFinite(Date.parse(at))
    ? at.slice(0, 10)
    : '';
};

/** Compatibility, never an episode assignment. No mutation of the canonical report or its totals. */
export const compareCudyrMonth = (
  data: CudyrReportDataset,
  categories?: CudyrSupplementReport,
  discharges?: CudyrDischargeReport,
  resolveIdentity?: ReturnType<typeof createCudyrIdentityResolver>
): CudyrComparisonItem[] => {
  const result: CudyrComparisonItem[] = [];
  const compared = new Set<string>();
  const sourceIdentities = new Map<string, number>();
  const identityKey =
    resolveIdentity || createCudyrIdentityResolver(data, categories ? [categories] : []);
  for (const patient of categories?.patients || []) {
    const key = identityKey(patient.document, patient.patientName);
    sourceIdentities.set(key, (sourceIdentities.get(key) || 0) + 1);
  }
  const byDocument = new Map<string, CudyrReportRow[]>();
  for (const row of data.rows) {
    const key = documentKey(row.rut);
    if (key) byDocument.set(key, [...(byDocument.get(key) || []), row]);
  }
  const identity = (document: string, patientName: string) => {
    const rows = document ? byDocument.get(documentKey(document)) || [] : [];
    const names = new Set(rows.map(r => identityKey(r.rut, r.patientName)));
    const sourceNames = new Set(
      [...(categories?.patients || []), ...(discharges?.rows || [])]
        .filter(r => documentKey(r.document) === documentKey(document))
        .map(r => identityKey(r.document, r.patientName))
    );
    const ambiguous =
      !document ||
      !patientName ||
      names.size > 1 ||
      sourceNames.size > 1 ||
      rows.some(
        r =>
          !r.clinicalEpisodeId ||
          identityKey(r.rut, r.patientName) !== identityKey(document, patientName)
      );
    return { rows, ambiguous };
  };
  for (const p of categories?.patients || [])
    for (const day of p.days) {
      if (day.state === 'blank') continue;
      const found = identity(p.document, p.patientName);
      const timed = found.rows.filter(r => sourceDate(r) === day.sourceDate);
      // A same-date census without a timed evaluation is context only, not temporal proof.
      const candidates = timed.length ? timed : found.rows.filter(r => r.date === day.sourceDate);
      if ((day.sourceDate < data.from || day.sourceDate > data.to) && !timed.length) continue;
      const episodes = new Set(candidates.map(r => r.clinicalEpisodeId));
      const ambiguous =
        found.ambiguous ||
        episodes.size > 1 ||
        candidates.length > 1 ||
        (sourceIdentities.get(identityKey(p.document, p.patientName)) || 0) > 1;
      let status: CudyrComparisonStatus;
      let reason: string;
      if (ambiguous) {
        status = 'identity_review';
        reason =
          'Documento compartido, filas fuente repetidas, nombre discordante, episodio ausente o varios candidatos. No se asignó el registro.';
      } else if (!candidates.length) {
        status = 'no_hhr_candidate';
        reason =
          'No hay contexto HHR compatible para esta fecha dentro de la lectura. No prueba ausencia de hospitalización.';
      } else if (!timed.length) {
        status = candidates[0].evaluation ? 'date_review' : 'no_hhr_result';
        reason =
          'El día del informe Eloísa no equivale automáticamente al día censal HHR. Una ausencia no acredita incumplimiento.';
      } else {
        const row = candidates[0];
        status =
          day.category && row.evaluation?.category === day.category
            ? 'compatible'
            : 'category_difference';
        reason =
          'Cotejo por documento, nombre y fecha literal de aplicación; el informe no acredita episodio, hora ni autor. Se conserva el día censal HHR.';
        compared.add(row.key);
      }
      result.push({
        key: `category:${p.sourceRow}:${day.sourceDay}`,
        source: 'Categorización Eloísa',
        sourceRow: p.sourceRow,
        sourceDate: day.sourceDate,
        sourceValue: day.originalValue,
        patientName: p.patientName,
        document: p.document,
        status,
        reason,
        candidateKeys: candidates.map(r => r.key),
      });
    }
  for (const p of discharges?.rows || []) {
    if (p.date < data.from || p.date > data.to) continue;
    const found = identity(p.document, p.patientName);
    const episodes = new Set(found.rows.map(r => r.clinicalEpisodeId));
    const ambiguous = found.ambiguous || episodes.size > 1;
    result.push({
      key: `discharge:${p.sourceRow}`,
      source: 'Alta administrativa Eloísa',
      sourceRow: p.sourceRow,
      sourceDate: p.date,
      sourceValue: `${p.time} · ${p.bed} · ${p.service}`,
      patientName: p.patientName,
      document: p.document,
      status: ambiguous
        ? 'identity_review'
        : found.rows.length
          ? 'discharge_review'
          : 'no_hhr_candidate',
      reason:
        'Cama al egreso, no historia diaria. Informe sin ID de episodio ni establecimiento explícito. Cotejar alta del sistema y alta real por separado; no se modifica ninguna fecha.',
      candidateKeys: found.rows.map(r => r.key),
    });
  }
  if (categories)
    for (const row of data.rows) {
      if (!row.evaluation || compared.has(row.key)) continue;
      const day = sourceDate(row);
      result.push({
        key: 'hhr:' + row.key,
        source: row.evaluation.source || 'HHR',
        sourceDate: day || row.date,
        sourceValue: row.evaluation.category,
        patientName: row.patientName,
        document: row.rut,
        status: 'hhr_only',
        candidateKeys: [row.key],
        reason: !day
          ? 'Resultado sin fecha de aplicación verificable; se conserva el resultado HHR sin atribuirlo al calendario Eloísa.'
          : !day.startsWith(categories.month)
            ? 'La aplicación pertenece a otro mes calendario. Revisar también ese informe para cerrar el turno de este censo.'
            : 'No hubo una contraparte documental inequívoca en la versión seleccionada. Se conserva el resultado HHR.',
      });
    }
  return result;
};

export const cudyrMonthlyInventory = (data: CudyrReportDataset) => ({
  days: data.coverage.length,
  availableDays: data.coverage.filter(d => d.state === 'disponible').length,
  rows: data.rows.length,
  withAuthor: data.rows.filter(r => r.evaluation?.author).length,
  manual: data.rows.filter(r => r.evaluation?.source === 'HHR · puntuación manual').length,
  withoutEpisode: data.rows.filter(r => !r.clinicalEpisodeId).length,
  eligibilityPending: data.rows.filter(r => r.eligibility === 'por_revisar').length,
});
