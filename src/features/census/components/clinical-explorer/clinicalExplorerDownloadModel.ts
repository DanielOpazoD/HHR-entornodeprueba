import type { MMRADExam } from '@/features/radiology/services/mmradService';
import { parseMmradStamp } from '@/features/radiology/services/mmradStamp';
import {
  DOWNLOAD_PARTS,
  type DownloadDocument,
  type DownloadFormat,
  type DownloadOutcomes,
  type DownloadPart,
  type DownloadRange,
} from './clinicalExplorerDownloadContracts';

export {
  DOWNLOAD_PARTS,
  DOWNLOAD_PART_LABELS,
  defaultDownloadRange,
  isIsoDay,
  labReadFrom,
  outcome,
  rangeProblem,
  type DownloadDocument,
  type DownloadFormat,
  type DownloadOutcomes,
  type DownloadPart,
  type DownloadRange,
  type DownloadRequest,
  type ListedStay,
  type PartOutcome,
} from './clinicalExplorerDownloadContracts';
export {
  EXTENSION_IN_PAGE_HISTORY_VERSION,
  describeRecordPart,
  isVersionAtLeast,
  recordProgressText,
  selectEpisodeHistory,
  type ArchiveFile,
  type HistoryArchive,
} from './clinicalExplorerRecordDownloadModel';
export {
  buildLabReportGroups,
  describeRange,
  labProgressText,
  planLabPart,
  settleLabRead,
  type LabReportGroup,
  type LabSettlement,
} from './clinicalExplorerLabDownloadModel';
export {
  describeCtPart,
  describeCtStudy,
  planCtReports,
  type CtReportPlan,
} from './clinicalExplorerCtDownloadModel';

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
