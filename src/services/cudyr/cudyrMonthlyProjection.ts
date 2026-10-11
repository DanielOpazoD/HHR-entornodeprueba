import { CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import type { ArchivedCudyrSupplement } from './cudyrSupplementService';
import { previousCensusIsoDay } from '@/domain/evaluationScales/importedCudyr';
import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';

const sourceDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLINICAL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export const cudyrApplicationSourceDate = (value?: string) => {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return sourceDateFormatter.format(new Date(value));
};

export { cudyrDocumentKey, cudyrNameKey, cudyrFullNameKey } from './cudyrSourceIdentity';
import { cudyrDocumentKey } from './cudyrSourceIdentity';
import { createCudyrIdentityResolver, cudyrOrderedIdentity } from './cudyrNameReconciliation';
import { resolveRepeatedMonthlyEpisodes } from './cudyrMonthlyEpisodeLink';
export const isEloisaCudyr = (source: string) => /elo[ií]sa/i.test(source);
export const monthlySourceIsFinal = (r: ArchivedCudyrSupplement, day: string, now: Date) => {
  const times = [r.capture?.observedAt || '', r.importedAt];
  return (
    r.bytesVerified === true &&
    r.capture?.source === 'extension_monthly_report' &&
    times.every(
      t =>
        Number.isFinite(Date.parse(t)) &&
        Date.parse(t) <= now.getTime() &&
        resolveCudyrPendingStatus(day, new Date(t)).phase === 'overdue'
    )
  );
};

/** Rebuildable official-source projection: no invented author, time, bed, or clinical episode. */
export const applyCudyrMonthlySources = (
  input: CudyrReportDataset,
  archives: ArchivedCudyrSupplement[]
): CudyrReportDataset => {
  const now = new Date(input.generatedAt);
  const rows = input.rows.map(r => ({ ...r, warnings: [...r.warnings] }));
  // Only Eloísa results contribute. Legacy manual values remain in their original persisted record.
  for (const row of rows)
    if (row.evaluation && !isEloisaCudyr(row.evaluation.source)) {
      row.evaluation = null;
      row.evaluationCount = 0;
      row.evaluationCapturedAt = undefined;
      row.cudyrStatus = 'sin_captura';
      row.warnings.push(
        'Puntuación manual antigua conservada en el censo; no se utiliza como CUDYR oficial.'
      );
    }
  const latest = new Map<string, ArchivedCudyrSupplement>();
  const verified: ArchivedCudyrSupplement[] = [];
  for (const a of archives) {
    if (a.capture?.source !== 'extension_monthly_report' || a.bytesVerified !== true) continue;
    if (
      !Number.isFinite(Date.parse(a.capture.observedAt)) ||
      Date.parse(a.capture.observedAt) > now.getTime()
    )
      continue;
    if (!Number.isFinite(Date.parse(a.importedAt)) || Date.parse(a.importedAt) > now.getTime())
      continue;
    verified.push(a);
    const old = latest.get(a.month);
    if (
      !old ||
      Date.parse(a.capture.observedAt) > Date.parse(old.capture!.observedAt) ||
      (Date.parse(a.capture.observedAt) === Date.parse(old.capture!.observedAt) &&
        a.importedAt > old.importedAt)
    )
      latest.set(a.month, a);
  }
  verified.sort(
    (a, b) =>
      Date.parse(a.capture!.observedAt) - Date.parse(b.capture!.observedAt) ||
      a.importedAt.localeCompare(b.importedAt)
  );
  const identity = createCudyrIdentityResolver(
    input,
    verified.map(a => a.report)
  );
  // Keep the newest positive per identity/day. A later empty snapshot cannot erase it.
  const positiveVersions = new Map<string, string>();
  const positiveCategories = new Map<string, Set<string>>();
  const cellKey = (document: string, name: string, date: string) =>
    JSON.stringify([identity(document, name), date]);
  for (const archive of verified)
    for (const patient of archive.report.patients)
      for (const cell of patient.days)
        if (
          cell.category &&
          monthlySourceIsFinal(archive, previousCensusIsoDay(cell.sourceDate), now)
        ) {
          const key = cellKey(patient.document, patient.patientName, cell.sourceDate);
          positiveVersions.set(key, archive.id);
          const categories = positiveCategories.get(key) || new Set<string>();
          categories.add(cell.category);
          positiveCategories.set(key, categories);
        }
  for (const archive of verified) {
    const repeatedLinks = resolveRepeatedMonthlyEpisodes(input, archive.report, identity);
    for (const patient of archive.report.patients) {
      const id = identity(patient.document, patient.patientName);
      const duplicated =
        !patient.document ||
        archive.report.patients.filter(p => identity(p.document, p.patientName) === id).length !==
          1;
      const own = input.rows.filter(r => identity(r.rut, r.patientName) === id);
      const episodes = new Set(own.map(r => r.clinicalEpisodeId).filter(Boolean));
      const absenceAmbiguous =
        episodes.size !== 1 ||
        own.some(r => !r.clinicalEpisodeId) ||
        input.rows.some(
          r =>
            cudyrDocumentKey(r.rut) === cudyrDocumentKey(patient.document) &&
            identity(r.rut, r.patientName) !== id
        );
      for (const cell of patient.days) {
        if (
          cell.category
            ? positiveVersions.get(
                cellKey(patient.document, patient.patientName, cell.sourceDate)
              ) !== archive.id
            : latest.get(archive.month)?.id !== archive.id
        )
          continue;
        const matching = rows.filter(
          r =>
            identity(r.rut, r.patientName) === id &&
            cudyrApplicationSourceDate(r.evaluation?.recordedAt) === cell.sourceDate
        );
        // An original timestamp takes priority over the agreed date-only night-shift rule.
        const date =
          matching.length === 1 ? matching[0].date : previousCensusIsoDay(cell.sourceDate);
        if (date < input.from || date > input.to || !monthlySourceIsFinal(archive, date, now))
          continue;
        const candidates = rows.filter(
          r => r.date === date && identity(r.rut, r.patientName) === id
        );
        // A blank in another stay is not contrary evidence to this day's proven positive owner.
        if (
          !cell.category &&
          duplicated &&
          candidates.length === 1 &&
          archive.report.patients.some(
            other =>
              repeatedLinks.get(other.sourceRow) === candidates[0].clinicalEpisodeId &&
              other.days.some(day => day.sourceDate === cell.sourceDate && day.category)
          )
        )
          continue;
        const linkedEpisode = cell.category ? repeatedLinks.get(patient.sourceRow) : undefined;
        const resolvedRepeat =
          linkedEpisode &&
          candidates.length === 1 &&
          candidates[0].clinicalEpisodeId === linkedEpisode;
        const ambiguous =
          (duplicated && !resolvedRepeat) ||
          candidates.length > 1 ||
          matching.length > 1 ||
          (!cell.category && absenceAmbiguous);
        if (ambiguous) {
          for (const r of candidates)
            r.warnings.push('Informe mensual: identidad o turno ambiguo; requiere cotejo.');
          if (!cell.category) continue;
        }
        let row = ambiguous ? undefined : candidates[0];
        if (
          row?.monthlyEvidence &&
          row.evaluation?.recordedAt &&
          row.monthlyEvidence.sourceDate !== cell.sourceDate &&
          !matching.length
        )
          continue;
        if (!row && !cell.category) continue;
        if (!row) {
          row = {
            key: `monthly:${archive.id}:${patient.sourceRow}:${date}`,
            date,
            clinicalEpisodeId: '',
            authorityDate: date,
            patientName: patient.patientName,
            firstName: '',
            lastName: '',
            secondLastName: '',
            rut: patient.document,
            documentType: '',
            diagnosis: patient.diagnosis,
            diagnosisCode: '',
            identitySource: 'Eloísa · informe mensual',
            identitySourceDate: cell.sourceDate,
            admissionDate: '',
            admissionTime: '',
            bedId: '',
            bedName: '',
            service: patient.service,
            specialty: '',
            group: 'sin_grupo',
            modality: 'desconocida',
            eligibility: 'por_revisar',
            eligibilityReason:
              'Paciente recuperado de Eloísa: falta su contexto censal y de cama de este día.',
            contextSource: 'eloisa_monthly_report',
            referenceAt: '',
            cudyrStatus: 'registrado',
            evaluation: null,
            evaluationCount: 0,
            lastCaptureAt: '',
            lastPersistedAt: '',
            captureActor: '',
            captureId: '',
            sourceRunId: '',
            dailyCudyrSavedAt: '',
            dailyCudyrSavedBy: '',
            medicalEpicrisisStatus: '',
            nursingEpicrisisStatus: '',
            epicrisisRegisteredAt: '',
            movements: [],
            warnings: [
              ambiguous
                ? 'Categoría oficial sin asociación clínica: identidad o turno ambiguo.'
                : 'Falta en el censo HHR de este día. No se presume cama ni elegibilidad.',
            ],
            applicationPending: false,
          };
          rows.push(row);
        }
        if (cell.category && latest.get(archive.month)?.id !== archive.id)
          row.warnings.push(
            'Resultado oficial conservado de un informe anterior; la versión posterior no aporta categoría para esta identidad y día.'
          );
        row.monthlyEvidence = {
          reportId: archive.id,
          sourceDate: cell.sourceDate,
          checkedAt: archive.capture!.observedAt,
          state: cell.category ? 'found' : 'absent',
          sourceRow: patient.sourceRow,
          ...(resolvedRepeat ? { linkMethod: 'episode_timeline' as const } : {}),
          ...(cudyrOrderedIdentity(row.rut, row.patientName) !==
          cudyrOrderedIdentity(patient.document, patient.patientName)
            ? {
                identityMatch: 'census_name_normalization' as const,
                sourcePatientName: patient.patientName,
              }
            : {}),
        };
        if (cell.category) {
          if (
            (positiveCategories.get(cellKey(patient.document, patient.patientName, cell.sourceDate))
              ?.size || 0) > 1
          ) {
            row.monthlyEvidence.state = 'conflict';
            row.warnings.push(
              'Los informes finales de Eloísa contienen categorías diferentes para este día; se muestra la más reciente y requiere cotejo.'
            );
          }
          const prior = row.evaluation;
          // Keep richer metadata only when it describes the same category/application date.
          const compatible =
            prior?.category === cell.category &&
            (!prior.recordedAt || cudyrApplicationSourceDate(prior.recordedAt) === cell.sourceDate);
          if (prior && !compatible)
            row.warnings.push(
              `Categoría actualizada desde el informe final de Eloísa (${prior.category} → ${cell.category}).`
            );
          row.evaluation = compatible
            ? prior
            : {
                category: cell.category,
                source: 'Eloísa · informe mensual',
                recordedAt: '',
                sourceEvaluationId: '',
                author: '',
                authorId: '',
                authorRole: '',
                metadataWarning: 'Informe mensual: autor y hora no informados.',
              };
          row.cudyrStatus = row.monthlyEvidence.state === 'conflict' ? 'por_revisar' : 'registrado';
          row.evaluationCount = Math.max(row.evaluationCount, 1);
          row.evaluationCapturedAt = archive.capture!.observedAt;
        } else if (row.evaluation) {
          // A positive original Eloísa application is still evidence; flag contradictory source cells.
          row.monthlyEvidence.state = 'conflict';
          row.warnings.push(
            'El informe mensual no muestra la aplicación de Eloísa ya guardada; requiere cotejo.'
          );
        } else row.cudyrStatus = 'sin_registro_observado';
      }
    }
  }
  return {
    ...input,
    rows: rows.sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.bedId.localeCompare(b.bedId) || a.key.localeCompare(b.key)
    ),
  };
};
