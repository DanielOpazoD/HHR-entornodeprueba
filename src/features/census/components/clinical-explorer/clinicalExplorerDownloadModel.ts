import { hasMMRADStructuredReport } from '@/components/modals/controllers/radiologyViewerContentController';
import type {
  AuditDocumentsProgress,
  AuditDocumentsResult,
} from '@/features/audit-documents/eloisa-history';
import type { SyslabHospitalizationReports } from '@/features/laboratory/hospitalization-reports';
import type { MMRADExam } from '@/services/radiology/mmradService';
import {
  formatMmradStamp,
  mmradStampSortKey,
  parseMmradStamp,
} from '@/services/radiology/mmradStamp';
import type { LabAnalysisData } from '@/types/domain/labAnalyticsTypes';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { isCtStudy } from './clinicalExplorerImagingModel';
import { buildLabDayRows, parseColumnKey, type LabDayRow } from './clinicalExplorerLabModel';

/** The three sources of the download, always in this order in the joined PDF and in the ZIP. */
export type DownloadPart = 'record' | 'lab' | 'ct';
export const DOWNLOAD_PARTS: readonly DownloadPart[] = ['record', 'lab', 'ct'];
export const DOWNLOAD_PART_LABELS: Record<DownloadPart, { title: string; source: string }> = {
  record: { title: 'Ficha clínica', source: 'Eloísa' },
  lab: { title: 'Exámenes de sangre', source: 'Syslab' },
  ct: { title: 'Informes de TAC', source: 'MMRAD' },
};

export type DownloadFormat = 'pdf' | 'zip';

/** ISO days, both included, on the hospital calendar. */
export interface DownloadRange {
  from: string;
  to: string;
}

export interface DownloadRequest {
  parts: DownloadPart[];
  /** Applies to the Syslab results only; the record and the CT reports cover the stay. */
  range: DownloadRange;
  format: DownloadFormat;
}

export interface DownloadDocument {
  part: DownloadPart;
  /** Name inside the ZIP, before the part number that keeps the parts in order. */
  fileName: string;
  bytes: Uint8Array;
}

/**
 * What one source brought. `empty` means the source answered and has nothing for the request;
 * `partial` and `failed` mean something is missing and `problem` says what and why (SAVE-01).
 */
export interface PartOutcome {
  status: 'complete' | 'empty' | 'partial' | 'failed';
  documents: DownloadDocument[];
  summary: string;
  problem?: string;
  /** Facts worth knowing that do not keep the download from going ahead. */
  notes: string[];
}

export type DownloadOutcomes = Partial<Record<DownloadPart, PartOutcome>>;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDay = (value: string): boolean => ISO_DAY.test(value);

/** From the admission to today, both on the hospital calendar; today alone without a usable admission. */
export const defaultDownloadRange = (admissionDate: string, today: string): DownloadRange => ({
  from: isIsoDay(admissionDate) && admissionDate <= today ? admissionDate : today,
  to: today,
});

export const rangeProblem = (range: DownloadRange): string | null => {
  if (!isIsoDay(range.from) || !isIsoDay(range.to)) return 'Elige las fechas de los exámenes.';
  if (range.from > range.to) return 'La fecha «desde» es posterior a la fecha «hasta».';
  return null;
};

/**
 * Syslab is read from the earlier of the admission and «desde»: a later «desde» filters the
 * explorer's own read instead of reading those reports again.
 */
export const labReadFrom = (admissionDate: string, from: string): string =>
  isIsoDay(admissionDate) && admissionDate < from ? admissionDate : from;

export const outcome = (
  status: PartOutcome['status'],
  summary: string,
  extra: Partial<Pick<PartOutcome, 'documents' | 'problem' | 'notes'>> = {}
): PartOutcome => ({
  status,
  summary,
  documents: extra.documents ?? [],
  notes: extra.notes ?? [],
  ...(extra.problem ? { problem: extra.problem } : {}),
});

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

// ---------------------------------------------------------------------------------------------
// Ficha clínica (Eloísa, through the extension)
// ---------------------------------------------------------------------------------------------

export const recordProgressText = (progress: AuditDocumentsProgress | null): string => {
  if (!progress || progress.phase === 'accepted') return 'Conectando con la extensión Eloísa…';
  if (progress.phase === 'listing') return 'Buscando la hospitalización en Eloísa…';
  if (progress.phase === 'downloading') {
    return `Descargando el historial (${progress.done} de ${progress.total})…`;
  }
  if (progress.phase === 'retrying') return 'Reintentando lo que Eloísa no entregó…';
  return 'Recibiendo el historial…';
};

export interface ArchiveFile {
  name: string;
  bytes: Uint8Array;
}

/**
 * The extension answers with a ZIP of official «Historial hospitalización» PDFs; `files` are those
 * PDFs, or null when the result brought no ZIP. An extension older than 0.48.71 saves the ZIP into
 * Downloads by itself, so this page never gets the history to join.
 */
export const describeRecordPart = (
  result: AuditDocumentsResult,
  files: readonly ArchiveFile[] | null
): PartOutcome => {
  const row = result.summary?.[0];
  if (result.ok && !files) {
    return outcome('failed', 'No incluida', {
      problem:
        `La extensión Eloísa es anterior a la versión 0.48.71 y guardó la ficha aparte en Descargas` +
        `${result.filename ? ` (${result.filename})` : ''}. Actualízala para incluirla aquí.`,
    });
  }
  if (!result.ok) {
    if (row && !row.error && row.hospitalizations === 0 && row.unverified === 0) {
      return outcome('empty', 'Eloísa no lista hospitalizaciones desde el ingreso.');
    }
    return outcome('failed', 'No incluida', {
      problem: row?.error
        ? `No se pudo consultar Eloísa: ${row.error}`
        : row && row.hospitalizations === 0 && row.unverified > 0
          ? `Eloísa lista ${plural(row.unverified, 'hospitalización', 'hospitalizaciones')} sin fecha o RUT verificable; revísalas allí.`
          : result.error || 'No se pudo descargar la ficha de Eloísa.',
    });
  }
  const pdfs = files ?? [];
  const notes = [
    row?.reconstructed
      ? `${plural(row.reconstructed, 'historial tiene', 'historiales tienen')} días que Eloísa no genera, rehechos con su resumen diario y un anexo HHR no oficial.`
      : '',
    row?.incomplete
      ? `${plural(row.incomplete, 'historial queda', 'historiales quedan')} sin parte de un día que Eloísa no genera.`
      : '',
    row?.unverified
      ? `Eloísa lista ${plural(row.unverified, 'hospitalización', 'hospitalizaciones')} sin fecha o RUT verificable; revísalas allí.`
      : '',
  ].filter(Boolean);
  const documents = pdfs.map(file => ({
    part: 'record' as const,
    fileName: file.name,
    bytes: file.bytes,
  }));
  const summary =
    pdfs.length === 1
      ? 'Historial de la hospitalización'
      : `${plural(pdfs.length, 'historial', 'historiales')} de hospitalización`;
  const failed = row?.failed ?? result.failedCount ?? 0;
  if (pdfs.length === 0) {
    return outcome('failed', 'No incluida', {
      problem: 'Eloísa no entregó el historial.',
      notes,
    });
  }
  if (failed > 0) {
    return outcome('partial', summary, {
      documents,
      notes,
      problem: `Eloísa no entregó ${failed} de ${plural(failed + pdfs.length, 'historial', 'historiales')}.`,
    });
  }
  return outcome('complete', summary, { documents, notes });
};

// ---------------------------------------------------------------------------------------------
// Exámenes (Syslab)
// ---------------------------------------------------------------------------------------------

/** What the Syslab read of the stay ended in, as the laboratory hook reports it. */
export type LabSettlement =
  | { kind: 'failed'; problem: string }
  | { kind: 'empty' }
  | { kind: 'ready'; analysis: LabAnalysisData; pending: number };

type LabRead = Pick<
  SyslabHospitalizationReports,
  'phase' | 'message' | 'analysis' | 'pending' | 'refreshing'
>;

/** Null while Syslab is still being asked; then how the read ended. A failure is never «sin informes». */
export const settleLabRead = (lab: LabRead): LabSettlement | null => {
  switch (lab.phase) {
    case 'checking':
    case 'listing':
    case 'reading':
      return null;
    case 'login-required':
      return {
        kind: 'failed',
        problem:
          'Syslab pide iniciar sesión. Inicia sesión desde Laboratorio y vuelve a intentarlo.',
      };
    case 'unavailable':
    case 'error':
      return { kind: 'failed', problem: lab.message || 'No se pudo leer Syslab.' };
    // A cached list or report set being renewed may lack the newest reports: wait for it.
    case 'empty':
      return lab.refreshing ? null : { kind: 'empty' };
    case 'ready':
      return lab.analysis && !lab.refreshing
        ? { kind: 'ready', analysis: lab.analysis, pending: lab.pending }
        : null;
  }
};

export const labProgressText = (
  lab: Pick<SyslabHospitalizationReports, 'phase' | 'progress'>
): string => {
  if (lab.phase === 'checking') return 'Comprobando la sesión de Syslab…';
  if (lab.phase === 'reading') {
    return lab.progress
      ? `Leyendo informes de Syslab (${lab.progress.completed} de ${lab.progress.total})…`
      : 'Leyendo informes de Syslab…';
  }
  return 'Consultando Syslab…';
};

/** One Syslab report (one order): its stamp and every result, in clinical order. */
export interface LabReportGroup {
  columnKey: string;
  dayIso: string;
  time: string;
  rows: LabDayRow[];
}

/** The results the explorer shows, of the reports inside the range, oldest first. */
export const buildLabReportGroups = (
  analysis: LabAnalysisData,
  range: DownloadRange
): LabReportGroup[] => {
  const days = new Set<string>();
  for (const columns of Object.values(analysis.comparison)) {
    for (const columnKey of Object.keys(columns)) {
      const when = parseColumnKey(columnKey);
      if (when && when.dayIso >= range.from && when.dayIso <= range.to) days.add(when.dayIso);
    }
  }
  const groups = new Map<string, LabReportGroup>();
  for (const dayIso of [...days].sort()) {
    for (const row of buildLabDayRows(analysis, dayIso)) {
      const group = groups.get(row.columnKey) ?? {
        columnKey: row.columnKey,
        dayIso,
        time: row.time,
        rows: [],
      };
      group.rows.push(row);
      groups.set(row.columnKey, group);
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.dayIso.localeCompare(b.dayIso) ||
      a.time.localeCompare(b.time) ||
      a.columnKey.localeCompare(b.columnKey)
  );
};

export const describeRange = (range: DownloadRange): string =>
  range.from === range.to
    ? `del ${formatDateDDMMYYYY(range.from)}`
    : `del ${formatDateDDMMYYYY(range.from)} al ${formatDateDDMMYYYY(range.to)}`;

/** Either the outcome without a PDF to write, or the reports to write it with. */
export const planLabPart = (
  settlement: LabSettlement,
  range: DownloadRange
): { outcome: PartOutcome } | { groups: LabReportGroup[]; summary: string; notes: string[] } => {
  if (settlement.kind === 'failed') {
    return { outcome: outcome('failed', 'No incluidos', { problem: settlement.problem }) };
  }
  const empty = `Sin informes de Syslab ${describeRange(range)}.`;
  if (settlement.kind === 'empty') return { outcome: outcome('empty', empty) };
  const groups = buildLabReportGroups(settlement.analysis, range);
  const notes = settlement.pending
    ? [
        `Syslab aún no entrega resultados de ${plural(settlement.pending, 'informe', 'informes')}; no van incluidos.`,
      ]
    : [];
  if (groups.length === 0) return { outcome: outcome('empty', empty, { notes }) };
  return {
    groups,
    summary: `${plural(groups.length, 'informe', 'informes')} ${describeRange(range)}`,
    notes,
  };
};

// ---------------------------------------------------------------------------------------------
// Informes de TAC (MMRAD)
// ---------------------------------------------------------------------------------------------

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
}: {
  plan: CtReportPlan;
  documents: DownloadDocument[];
  /** Studies whose report could not be downloaded. */
  failures: string[];
  /** The search for studies registered under another check digit did not finish. */
  searchIncomplete: boolean;
}): PartOutcome => {
  const problems = [
    failures.length ? `No se pudo descargar: ${failures.join('; ')}.` : '',
    plan.withheld.length
      ? `MMRAD registró con otro dígito verificador: ${plan.withheld.join('; ')}. No van incluidos; revísalos en Imágenes.`
      : '',
    searchIncomplete
      ? 'La búsqueda de TAC registrados con otro dígito verificador no terminó; puede faltar alguno.'
      : '',
  ].filter(Boolean);
  const notes = plan.unreported;
  const summary = documents.length
    ? plural(documents.length, 'informe', 'informes')
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

// ---------------------------------------------------------------------------------------------
// File names and the final decision
// ---------------------------------------------------------------------------------------------

/** Plain ASCII, as the extension names its files, so every system opens them. */
const asciiText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 .,()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const patientFileLabel = (patientName: string): string =>
  asciiText(patientName).slice(0, 80) || 'Paciente';

export const bundleFileName = (
  patientName: string,
  today: string,
  format: DownloadFormat
): string =>
  `${patientFileLabel(patientName)} - Ficha examenes e informes TAC - ${today}.${format}`;

export const labFileName = (patientName: string, range: DownloadRange): string =>
  `${patientFileLabel(patientName)} - Examenes de laboratorio - ${range.from} a ${range.to}.pdf`;

export const ctFileName = (patientName: string, exam: MMRADExam): string => {
  const stamp = parseMmradStamp(exam.fecha_examen);
  const day = stamp ? `${stamp.year}-${stamp.month}-${stamp.day}` : 'sin fecha';
  const study = asciiText(exam.nombre_examen).slice(0, 60) || 'TAC';
  return `${patientFileLabel(patientName)} - Informe TAC - ${day} - ${study}.pdf`;
};

/** ZIP entries numbered by part (1 ficha, 2 exámenes, 3 TAC), each name used once. */
export const zipEntryNames = (documents: readonly DownloadDocument[]): string[] => {
  const used = new Set<string>();
  return documents.map(document => {
    const base = `${DOWNLOAD_PARTS.indexOf(document.part) + 1} ${document.fileName}`;
    let name = base;
    for (let copy = 2; used.has(name.toLowerCase()); copy += 1) {
      name = base.replace(/\.pdf$/i, ` (${copy}).pdf`);
    }
    used.add(name.toLowerCase());
    return name;
  });
};

export interface DownloadReview {
  /** Every document available, ficha first, then exámenes, then TAC. */
  documents: DownloadDocument[];
  /** Parts with something missing: the person decides whether to download the rest. */
  incomplete: DownloadPart[];
}

export const reviewDownload = (
  parts: readonly DownloadPart[],
  outcomes: DownloadOutcomes
): DownloadReview => ({
  documents: DOWNLOAD_PARTS.filter(part => parts.includes(part)).flatMap(
    part => outcomes[part]?.documents ?? []
  ),
  incomplete: DOWNLOAD_PARTS.filter(part => {
    const status = outcomes[part]?.status;
    return parts.includes(part) && (status === 'partial' || status === 'failed');
  }),
});
