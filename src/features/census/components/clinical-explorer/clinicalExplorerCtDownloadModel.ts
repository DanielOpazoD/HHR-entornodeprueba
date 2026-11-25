import {
  formatMmradStamp,
  hasMMRADStructuredReport,
  mmradStampSortKey,
  type MMRADExam,
} from '@/features/radiology/public';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { isCtStudy } from './clinicalExplorerImagingModel';
import {
  outcome,
  pluralCount,
  type DownloadDocument,
  type PartOutcome,
} from './clinicalExplorerDownloadContracts';

export interface CtReportPlan {
  /** CT studies whose report goes in, oldest first: the original PDF, or its text when MMRAD has no PDF. */
  included: Array<{ exam: MMRADExam; source: 'pdf' | 'text' }>;
  /** CT studies MMRAD registered under another check digit: a person confirms them first. */
  withheld: string[];
  /** CT studies whose report MMRAD has not published yet. */
  unreported: string[];
  ctCount: number;
}

export const describeCtStudy = (exam: MMRADExam): string =>
  `${exam.nombre_examen.trim() || 'TAC'} (${formatMmradStamp(exam.fecha_examen)})`;

export const planCtReports = (studies: readonly MMRADExam[]): CtReportPlan => {
  const cts = studies
    .filter(isCtStudy)
    .sort((a, b) =>
      mmradStampSortKey(a.fecha_examen).localeCompare(mmradStampSortKey(b.fecha_examen))
    );
  const plan: CtReportPlan = { included: [], withheld: [], unreported: [], ctCount: cts.length };
  for (const exam of cts) {
    if (exam.registered_patient_id) {
      // A study registered under another check digit is shown in the explorer for a person to
      // confirm; it never goes into this patient's file unconfirmed (ID-01).
      plan.withheld.push(describeCtStudy(exam));
    } else if (exam.pdf_url) {
      plan.included.push({ exam, source: 'pdf' });
    } else if (hasMMRADStructuredReport(exam)) {
      plan.included.push({ exam, source: 'text' });
    } else {
      plan.unreported.push(`${describeCtStudy(exam)}: MMRAD aún no publica su informe.`);
    }
  }
  return plan;
};

/**
 * The CT part once every report was asked for. A report that did not come, a study held back for
 * its check digit, or an unfinished check-digit search may leave a CT out: the person decides.
 */
export const describeCtPart = ({
  plan,
  documents,
  failures,
  searchIncomplete,
  laterThanCensus = null,
}: {
  plan: CtReportPlan;
  documents: DownloadDocument[];
  /** Studies whose report could not be downloaded. */
  failures: string[];
  /** The search for studies registered under another check digit did not finish. */
  searchIncomplete: boolean;
  /** CT studies after a past census day, left out because they may belong to a later stay. */
  laterThanCensus?: { day: string; studies: string[] } | null;
}): PartOutcome => {
  const problems = [
    failures.length ? `No se pudo descargar: ${failures.join('; ')}.` : '',
    plan.withheld.length
      ? `MMRAD registró con otro dígito verificador: ${plan.withheld.join('; ')}. No van incluidos; revísalos en Imágenes.`
      : '',
    searchIncomplete
      ? 'La búsqueda de TAC registrados con otro dígito verificador no terminó; puede faltar alguno.'
      : '',
    laterThanCensus
      ? `Posteriores al ${formatDateDDMMYYYY(laterThanCensus.day)}: ${laterThanCensus.studies.join('; ')}. No van incluidos: desde un censo pasado no se puede comprobar que sean de esta hospitalización; ábrelos desde el censo de hoy si sigue hospitalizado.`
      : '',
  ].filter(Boolean);
  const notes = plan.unreported;
  const summary = documents.length
    ? pluralCount(documents.length, 'informe', 'informes')
    : plan.ctCount === 0
      ? 'Sin TAC en esta hospitalización.'
      : plan.included.length === 0 && plan.withheld.length === 0
        ? 'Ningún TAC de la hospitalización tiene informe publicado.'
        : 'No incluidos';
  if (problems.length) {
    return outcome(documents.length ? 'partial' : 'failed', summary, {
      documents,
      notes,
      problem: problems.join(' '),
    });
  }
  return outcome(documents.length ? 'complete' : 'empty', summary, { documents, notes });
};
