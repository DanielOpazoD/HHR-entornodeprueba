import { createCudyrRecoveredRow } from './cudyrRecoveredRow';
import { cudyrDocumentKey, cudyrIdentity, cudyrNameKey } from './cudyrSourceIdentity';
import type { CudyrReportDataset, CudyrReportRow } from '@/types/domain/cudyrReport';
import type { ArchivedCudyrSupplement } from './cudyrSupplementService';
import { monthlySourceIsFinal } from './cudyrMonthlyProjection';
import { getNextDay } from '@/utils/clinicalDayUtils';
import { cudyrReferenceInstant } from '@/domain/cudyr/cudyrDailyPlacement';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';

export interface CudyrVerifiedContextEntry {
  date: string;
  reportId: string;
  sourceRow: number | null;
  /** Documentary RN identity: this specific source row belongs to the mother, never the child. */
  maternalSourceRow?: number;
  patientName?: string;
  clinicalEpisodeId: string;
  admissionAt: string;
  dischargeAt: string;
  modality: 'hospitalizacion' | 'cuna' | 'cma' | 'uea';
  group: CudyrReportRow['group'];
  bedId: string;
  bedName: string;
  document: string;
  documentType: string;
  basis: 'reviewed_documentary_context' | 'reviewed_report_absence';
  reason: string;
  evidenceHashes: string[];
}
export interface CudyrVerifiedContext {
  censusApproval?: import('./cudyrCensusApproval').CudyrCensusApproval;
  schemaVersion: 1;
  month: string;
  revision: number;
  entries: CudyrVerifiedContextEntry[];
  reconstructedDays?: Array<{ date: string; reason: string; evidenceHashes: string[] }>;
  reviewedBy: { uid: string; name: string; email: string; role: string };
  updatedAt: string;
  verification: 'reviewed_documentary_context';
  files: Array<{ name: string; sha256: string; byteLength: number }>;
}

/** Bind reviewed episode/day context to immutable Eloísa cells. Never accepts a manual score. */
export const applyCudyrVerifiedContexts = (
  input: CudyrReportDataset,
  sources: ArchivedCudyrSupplement[],
  reviews: CudyrVerifiedContext[]
): CudyrReportDataset => {
  let rows = input.rows.map(r => ({ ...r, warnings: [...r.warnings] }));
  const issues = [...input.issues];
  for (const review of reviews) {
    if (review.verification !== 'reviewed_documentary_context') continue;
    for (const entry of review.entries) {
      if (entry.date < input.from || entry.date > input.to) continue;
      const archive = sources.find(s => s.id === entry.reportId);
      if (entry.basis === 'reviewed_report_absence') {
        const sourceDate = getNextDay(entry.date);
        const name = (value: string) => cudyrNameKey(value).replace(/[^A-Z0-9]/g, '');
        const targets = rows.filter(
          r => r.date === entry.date && r.clinicalEpisodeId === entry.clinicalEpisodeId
        );
        let target = targets[0];
        let seeded = false;
        if (!target && entry.patientName && entry.evidenceHashes.length) {
          target = createCudyrRecoveredRow(entry.date, entry.patientName, entry.document);
          target.clinicalEpisodeId = entry.clinicalEpisodeId;
          const stamp = calendarStampInClinicalTimeZone(new Date(entry.admissionAt));
          const cutoff = cudyrReferenceInstant(entry.date);
          const hours = cutoff
            ? (Date.parse(cutoff) - Date.parse(entry.admissionAt)) / 3600000
            : -1;
          target.admissionDate = stamp.iso;
          target.admissionTime = stamp.hhmm;
          target.hospitalAdmissionAt = entry.admissionAt;
          target.bedId = entry.bedId;
          target.bedName = entry.bedName;
          target.modality = entry.modality;
          target.group = entry.group;
          target.eligibility =
            entry.modality === 'hospitalizacion' && hours >= 8 ? 'elegible' : 'no_elegible';
          target.eligibilityReason =
            entry.modality === 'cma'
              ? 'CMA: exclusión diaria CUDYR.'
              : entry.modality === 'cuna'
                ? 'Cuna: exclusión diaria CUDYR.'
                : entry.modality === 'uea'
                  ? 'UEA: cama de Urgencias excluida de CUDYR.'
                  : hours < 8
                    ? 'Hospitalización menor de 8 horas al corte de 01:00 del día siguiente.'
                    : 'Contexto censal documental.';
          seeded = true;
          targets.push(target);
        }
        if (
          !archive ||
          entry.sourceRow !== null ||
          !entry.document ||
          !entry.patientName ||
          archive.report.month !== sourceDate.slice(0, 7) ||
          !monthlySourceIsFinal(archive, entry.date, new Date(input.generatedAt)) ||
          targets.length !== 1 ||
          cudyrDocumentKey(target.rut) !== cudyrDocumentKey(entry.document) ||
          name(target.patientName) !== name(entry.patientName)
        ) {
          issues.push(`Verificación ${entry.date}: falta corroborar identidad o informe completo.`);
          continue;
        }
        // A subsequently recovered positive or identified source cell supersedes this absence.
        if (target.evaluation || target.monthlyEvidence) continue;
        const mother = archive.report.patients.find(p => p.sourceRow === entry.maternalSourceRow);
        const maternalBinding =
          entry.modality === 'cuna' &&
          mother &&
          cudyrDocumentKey(mother.document) === cudyrDocumentKey(entry.document) &&
          !/^(RN|RECIEN NACIDO|RECIEN NACIDA)\b/.test(cudyrNameKey(mother.patientName)) &&
          name(mother.patientName) !== name(entry.patientName);
        if (entry.maternalSourceRow !== undefined && !maternalBinding) {
          issues.push(`Verificación ${entry.date}: vínculo materno inválido.`);
          continue;
        }
        const competing = sources.some(
          source =>
            source.report.month === archive.report.month &&
            monthlySourceIsFinal(source, entry.date, new Date(input.generatedAt)) &&
            source.report.patients.some(
              p =>
                !(
                  maternalBinding &&
                  cudyrDocumentKey(p.document) === cudyrDocumentKey(mother.document) &&
                  name(p.patientName) === name(mother.patientName)
                ) &&
                (cudyrDocumentKey(p.document) === cudyrDocumentKey(entry.document) ||
                  name(p.patientName) === name(entry.patientName!))
            )
        );
        if (competing) {
          issues.push(
            `Verificación ${entry.date}: existe una identidad en el informe que requiere cotejo.`
          );
          continue;
        }
        const reference = cudyrReferenceInstant(entry.date);
        if (
          !reference ||
          !Number.isFinite(Date.parse(entry.admissionAt)) ||
          !Number.isFinite(Date.parse(entry.dischargeAt)) ||
          Date.parse(entry.dischargeAt) <= Date.parse(entry.admissionAt)
        ) {
          issues.push(`Verificación ${entry.date}: intervalo hospitalario inválido.`);
          continue;
        }
        if (seeded) {
          target.referenceAt = reference;
          target.contextSource = 'verified_documentary_context';
          target.hospitalStayAdmissionAt = entry.admissionAt;
          target.hospitalAdmissionSource =
            'Conciliación documental verificada · Eloísa / censo HHR';
          target.resolvedSystemDeparture = Date.parse(entry.dischargeAt) <= Date.parse(reference);
          if (target.resolvedSystemDeparture) {
            target.eligibility = 'no_elegible';
            target.eligibilityReason = 'Egreso confirmado antes del corte CUDYR.';
          }
          rows.push(target);
        }
        // Verification of a complete query only: preserve census, admission, bed and eligibility.
        target.cudyrStatus = 'sin_registro_observado';
        target.monthlyEvidence = {
          reportId: archive.id,
          sourceDate,
          checkedAt: archive.capture!.observedAt,
          state: 'absent',
        };
        target.verifiedContext = {
          revision: review.revision,
          reviewedAt: review.updatedAt,
          reviewedBy: review.reviewedBy.name,
          reason: entry.reason,
          evidenceHashes: entry.evidenceHashes,
          applicationTimingBasis: 'assumed_before_0800',
        };
        continue;
      }
      const patient = archive?.report.patients.find(p => p.sourceRow === entry.sourceRow);
      const cell = patient?.days.find(d => d.sourceDate === getNextDay(entry.date));
      if (
        !archive ||
        !cell ||
        !monthlySourceIsFinal(archive, entry.date, new Date(input.generatedAt))
      ) {
        issues.push(`Conciliación ${entry.date}: falta verificar el informe de origen.`);
        continue;
      }
      const sourceRows = rows.filter(r => {
        if (r.date !== entry.date || !r.monthlyEvidence) return false;
        if (
          r.monthlyEvidence.reportId === entry.reportId &&
          r.monthlyEvidence.sourceRow === entry.sourceRow
        )
          return true;
        // A later download may have a new archive ID / row order. Reuse reviewed identity only
        // for one exact document + full-name source row, never fuzzy names or a shared RN RUT.
        const newer = sources.find(s => s.id === r.monthlyEvidence!.reportId);
        if (
          !newer ||
          !patient ||
          !monthlySourceIsFinal(newer, entry.date, new Date(input.generatedAt))
        )
          return false;
        const candidates = newer.report.patients.filter(
          p =>
            cudyrIdentity(p.document, p.patientName) ===
            cudyrIdentity(patient.document, patient.patientName)
        );
        return (
          candidates.length === 1 &&
          candidates[0].sourceRow === r.monthlyEvidence.sourceRow &&
          r.monthlyEvidence.sourceDate === cell.sourceDate
        );
      });
      const targets = rows.filter(
        r => r.date === entry.date && r.clinicalEpisodeId === entry.clinicalEpisodeId
      );
      // Never consume a cell already assigned to another episode or two existing targets.
      if (
        targets.length > 1 ||
        sourceRows.some(r => r.clinicalEpisodeId && r.clinicalEpisodeId !== entry.clinicalEpisodeId)
      ) {
        issues.push(`Conciliación ${entry.date}: vínculo de episodio contradictorio.`);
        continue;
      }
      const target =
        targets[0] ||
        sourceRows[0] ||
        (patient
          ? createCudyrRecoveredRow(entry.date, patient.patientName, patient.document)
          : undefined);
      if (!target) {
        issues.push(`Conciliación ${entry.date}: no se encontró la fila de origen.`);
        continue;
      }
      const conflict =
        cell.state === 'uncategorized' ||
        sourceRows.some(
          r =>
            r.monthlyEvidence?.state === 'conflict' ||
            (r.evaluation && r.evaluation.category !== cell.category)
        ) ||
        (target.evaluation && (!cell.category || target.evaluation.category !== cell.category));
      if (conflict) {
        issues.push(
          `Conciliación ${entry.date}: el CUDYR difiere del informe; se conserva para revisión.`
        );
        continue;
      }
      const cutoff = cudyrReferenceInstant(entry.date);
      const admission = Date.parse(entry.admissionAt),
        discharge = Date.parse(entry.dischargeAt);
      if (
        !cutoff ||
        !Number.isFinite(admission) ||
        !Number.isFinite(discharge) ||
        discharge <= admission
      )
        continue;
      const stamp = calendarStampInClinicalTimeZone(new Date(admission));
      const hours = (Date.parse(cutoff) - admission) / 3600000;
      const manualExclusion = Boolean(
        target.exclusion?.reason || target.correction?.actualDischarge
      );
      const resolved = target.resolvedSystemDeparture === true;
      const eligible =
        entry.modality === 'hospitalizacion' &&
        entry.group !== 'sin_grupo' &&
        hours >= 8 &&
        discharge > Date.parse(cutoff);
      const excludedReason =
        entry.modality === 'cuna'
          ? 'Cuna: exclusión diaria CUDYR.'
          : entry.modality === 'cma'
            ? 'CMA: exclusión diaria CUDYR.'
            : entry.modality === 'uea'
              ? 'UEA: cama de Urgencias excluida de CUDYR.'
              : hours < 8
                ? 'Hospitalización menor de 8 horas al corte de 01:00 del día siguiente.'
                : 'Egreso confirmado antes del corte CUDYR.';
      const mergedRows = [target, ...sourceRows];
      const richness = (r: CudyrReportRow) =>
        r.evaluation
          ? Number(Boolean(r.evaluation.recordedAt)) * 8 +
            Number(Boolean(r.evaluation.author)) * 4 +
            Number(Boolean(r.evaluation.sourceEvaluationId)) * 2 +
            Number(Boolean(r.evaluation.items?.length))
          : -1;
      const evaluationOwner = mergedRows
        .filter(r => r.evaluation?.category === cell.category)
        .sort((a, b) => richness(b) - richness(a))[0];
      const evaluation =
        evaluationOwner?.evaluation ||
        (cell.category
          ? {
              category: cell.category,
              source: 'Eloísa · informe mensual',
              recordedAt: '',
              sourceEvaluationId: '',
              author: '',
              authorId: '',
              authorRole: '',
              metadataWarning:
                'Informe histórico sin autor ni hora; madrugada anterior a las 08:00 asumida para asociar el turno.',
            }
          : null);
      const row: CudyrReportRow = {
        ...target,
        clinicalEpisodeId: entry.clinicalEpisodeId,
        key: targets[0]?.key || `${entry.date}:verified:${entry.clinicalEpisodeId}`,
        rut: entry.document || target.rut,
        documentType: entry.documentType || target.documentType,
        admissionDate: stamp.iso,
        admissionTime: stamp.hhmm,
        hospitalAdmissionAt: entry.admissionAt,
        hospitalStayAdmissionAt: entry.admissionAt,
        hospitalAdmissionSource: 'Conciliación documental verificada · Eloísa / censo HHR',
        admissionEvidenceConflict: false,
        bedId: entry.bedId || target.bedId,
        bedName: entry.bedName || target.bedName || 'Hospitalizados · código no informado',
        service: target.service || 'Servicio Hospitalizados HHR',
        group: entry.group,
        modality: entry.modality,
        contextSource: 'verified_documentary_context',
        eligibility:
          manualExclusion || resolved ? target.eligibility : eligible ? 'elegible' : 'no_elegible',
        eligibilityReason:
          manualExclusion || resolved
            ? target.eligibilityReason
            : eligible
              ? 'Cumple ocho horas de hospitalización al corte de 01:00 del día siguiente.'
              : excludedReason,
        referenceAt: cutoff,
        evaluation,
        evaluationCount: evaluation ? Math.max(1, ...mergedRows.map(r => r.evaluationCount)) : 0,
        evaluationCapturedAt: evaluationOwner?.evaluationCapturedAt || target.evaluationCapturedAt,
        cudyrStatus: evaluation ? 'registrado' : 'sin_registro_observado',
        monthlyEvidence: {
          reportId: archive.id,
          sourceDate: cell.sourceDate,
          sourceRow: entry.sourceRow ?? undefined,
          checkedAt: archive.capture!.observedAt,
          state: cell.category ? 'found' : 'absent',
        },
        verifiedContext: {
          revision: review.revision,
          reviewedAt: review.updatedAt,
          reviewedBy: review.reviewedBy.name,
          reason: entry.reason,
          evidenceHashes: entry.evidenceHashes,
          applicationTimingBasis: evaluation?.recordedAt ? 'recorded_time' : 'assumed_before_0800',
        },
        warnings: target.warnings.filter(
          w => !w.includes('falta su contexto censal') && !w.includes('sin asociación')
        ),
      };
      const consumed = new Set([target.key, ...sourceRows.map(r => r.key)]);
      rows = rows.filter(r => !consumed.has(r.key));
      rows.push(row);
    }
  }
  rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.bedId.localeCompare(b.bedId) ||
      a.patientName.localeCompare(b.patientName)
  );
  const coverage = input.coverage.map(day => {
    const reconstructed = reviews
      .flatMap(r =>
        r.verification === 'reviewed_documentary_context' ? r.reconstructedDays || [] : []
      )
      .find(d => d.date === day.date);
    return reconstructed
      ? { ...day, state: 'disponible' as const, documentaryReconstruction: reconstructed }
      : day;
  });
  return { ...input, rows, issues, coverage };
};
