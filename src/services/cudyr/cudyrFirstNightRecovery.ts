import type { CudyrSupplementReport } from '@/types/domain/cudyrSupplement';
import { reconcileCudyrDischarge } from './cudyrReportReconciliation';
import type { CudyrReportRow, CudyrReportDataset } from '@/types/domain/cudyrReport';
import { createCudyrIdentityResolver } from './cudyrNameReconciliation';
import { getNextDay, resolveClinicalDayForDateTime } from '@/utils/clinicalDayUtils';
import { cudyrReferenceInstant } from '@/domain/cudyr/cudyrDailyPlacement';

/** A source-positive first night can be missing from HHR but present in the next census.
 * Use its documented first hospital admission; do not infer an older stay or a shared RN identity.
 */
export const applyCudyrFirstNightRecovery = (
  data: CudyrReportDataset,
  sources: CudyrSupplementReport[]
): CudyrReportDataset => {
  const original = data.rows.filter(
    r => r.clinicalEpisodeId && r.contextSource !== 'eloisa_monthly_report'
  );
  const identity = createCudyrIdentityResolver(data, sources);
  const consumed = new Set<string>();
  const recovered = data.rows
    .filter(r => r.contextSource === 'eloisa_monthly_report')
    .flatMap(source => {
      if (
        source.monthlyEvidence?.state !== 'found' ||
        !source.rut.trim() ||
        data.rows.filter(
          row =>
            row.contextSource === 'eloisa_monthly_report' &&
            row.date === source.date &&
            identity(row.rut, row.patientName) === identity(source.rut, source.patientName)
        ).length !== 1
      )
        return [];
      const own = original.filter(
        r => identity(r.rut, r.patientName) === identity(source.rut, source.patientName)
      );
      const episodes = new Set(own.map(r => r.clinicalEpisodeId));
      const next = own.filter(r => r.date === getNextDay(source.date));
      if (episodes.size !== 1 || next.length !== 1 || own.some(r => r.date <= source.date))
        return [];
      const context = next[0];
      if (
        !context.hospitalAdmissionAt ||
        context.eligibility === 'por_revisar' ||
        context.bedHistory?.some(
          movement =>
            movement.status !== 'anulada' &&
            (movement.status === 'contradictoria' ||
              movement.modality !== 'hospitalizacion' ||
              movement.bed.replace(/\s/g, '').toUpperCase() !==
                context.bedName.replace(/\s/g, '').toUpperCase())
        ) ||
        !context.hospitalStayAdmissionAt ||
        resolveClinicalDayForDateTime(context.admissionDate, context.admissionTime) !==
          source.date ||
        context.admissionEvidenceConflict ||
        context.exclusion ||
        context.modality !== 'hospitalizacion' ||
        context.group === 'sin_grupo' ||
        !source.evaluation ||
        !source.monthlyEvidence
      )
        return [];
      const referenceAt = cudyrReferenceInstant(source.date);
      if (!referenceAt) return [];
      const eligible =
        Date.parse(referenceAt) - Date.parse(context.hospitalStayAdmissionAt) >= 8 * 3600000;
      const candidate: CudyrReportRow = {
        ...context,
        key: `${source.date}:${context.clinicalEpisodeId}:first-night`,
        date: source.date,
        contextSource: 'hhr_first_night_recovery',
        authorityDate: context.date,
        referenceAt,
        eligibility: eligible ? ('elegible' as const) : ('no_elegible' as const),
        eligibilityReason: eligible
          ? 'Ingreso hospitalario documentado antes de las 17:00; primer turno recuperado.'
          : 'Hospitalización menor de 8 horas al corte de 01:00 del día siguiente.',
        evaluation: source.evaluation,
        evaluationCount: source.evaluationCount,
        evaluationCapturedAt: source.evaluationCapturedAt,
        captureId: source.captureId,
        captureActor: source.captureActor,
        sourceRunId: source.sourceRunId,
        lastCaptureAt: source.lastCaptureAt,
        lastPersistedAt: source.lastPersistedAt,
        dailyCudyrSavedAt: source.dailyCudyrSavedAt,
        dailyCudyrSavedBy: source.dailyCudyrSavedBy,
        applicationPending: source.applicationPending,
        verifiedContext: undefined,
        monthlyEvidence: source.monthlyEvidence,
        cudyrStatus: 'registrado' as const,
        resolvedSystemDeparture: false,
        movements: context.movements,
        exclusion: undefined,
        warnings: [
          `Primer turno recuperado con ingreso hospitalario del censo ${context.date} y CUDYR de Eloísa.`,
        ],
      };
      const reconciled = reconcileCudyrDischarge(candidate);
      // A departure flag without its date/time cannot establish an earlier night's presence.
      if (
        reconciled.eligibility === 'por_revisar' ||
        (context.resolvedSystemDeparture &&
          !context.correction?.actualDischarge &&
          !context.movements.some(m => ['discharges', 'transfers'].includes(m.section)))
      )
        return [];
      consumed.add(source.key);
      return [reconciled];
    });
  return { ...data, rows: [...data.rows.filter(r => !consumed.has(r.key)), ...recovered] };
};
