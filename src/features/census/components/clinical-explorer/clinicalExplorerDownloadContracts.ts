export type { ListedStay } from './clinicalExplorerDownloadScope';

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

export const pluralCount = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;
