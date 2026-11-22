import type {
  AuditDocumentsProgress,
  AuditDocumentsResult,
} from '@/features/audit-documents/eloisa-history';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import type { ListedStay } from './clinicalExplorerDownloadScope';
import { outcome, pluralCount, type PartOutcome } from './clinicalExplorerDownloadContracts';

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

export interface HistoryArchive {
  files: ArchiveFile[];
  /** Null when the summary is missing or unreadable: then no stay can be verified. */
  stays: ListedStay[] | null;
}

/** In-page delivery of the history ZIP, so it can be joined here, starts with this version. */
export const EXTENSION_IN_PAGE_HISTORY_VERSION = '0.48.71';

/** True when `version` (e.g. «0.48.74») is at least `minimum`; anything unreadable is false. */
export const isVersionAtLeast = (version: string, minimum: string): boolean => {
  if (!/^\d+(?:\.\d+){0,3}$/.test(version)) return false;
  const have = version.split('.').map(Number);
  const need = minimum.split('.').map(Number);
  for (let index = 0; index < Math.max(have.length, need.length); index++) {
    const difference = (have[index] ?? 0) - (need[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
};

/**
 * Eloísa is asked by RUN and the admission day, so the ZIP may list another stay of the same person
 * that touches that day (a same-day readmission, a duplicate admission). Only a stay that starts on
 * this episode's admission day can be this episode's. Every listed stay counts, delivered or not:
 * if two start that day and one failed, the delivered one may be the other episode (ID-01).
 */
export const selectEpisodeHistory = (
  archive: HistoryArchive,
  admissionDate: string
):
  | { kind: 'one'; file: ArchiveFile }
  | { kind: 'undelivered' }
  | { kind: 'unverifiable' }
  | { kind: 'none' }
  | { kind: 'several'; count: number } => {
  if (!archive.stays) return { kind: 'unverifiable' };
  const matches = archive.stays.filter(stay => stay.startDate === admissionDate);
  if (matches.length > 1) return { kind: 'several', count: matches.length };
  const [stay] = matches;
  if (!stay) return { kind: 'none' };
  const file = stay.fileName ? archive.files.find(item => item.name === stay.fileName) : undefined;
  return file ? { kind: 'one', file } : { kind: 'undelivered' };
};

const SELECTION_PROBLEMS = {
  undelivered: () => 'Eloísa no entregó el historial de esta hospitalización.',
  unverifiable: () =>
    'No se pudo leer el resumen que entrega la extensión Eloísa, así que no se puede comprobar a qué hospitalización corresponde el historial.',
  none: (day: string) =>
    `Eloísa no muestra una hospitalización de este RUT que empiece el ${day}; no se incluye para no traer otra estadía.`,
  several: (day: string, count: number) =>
    `Eloísa tiene ${count} hospitalizaciones de este RUT que empiezan el ${day} (por ejemplo, un ingreso duplicado); no se incluye para no mezclar episodios. Ábrela desde Eloísa.`,
} as const;

/**
 * The extension answers with a ZIP of official «Historial hospitalización» PDFs; `files` are those
 * PDFs, or null when the result brought no ZIP. An extension older than 0.48.71 saves the ZIP into
 * Downloads by itself, so this page never gets the history to join.
 */
export const describeRecordPart = (
  result: AuditDocumentsResult,
  archive: HistoryArchive | null,
  admissionDate: string
): PartOutcome => {
  const row = result.summary?.[0];
  if (result.ok && !archive) {
    return outcome('failed', 'No incluida', {
      problem:
        `La extensión Eloísa es anterior a la versión 0.48.71 y guardó la ficha aparte en Descargas` +
        `${result.filename ? ` (${result.filename})` : ''}. Actualízala para incluirla aquí.`,
    });
  }
  if (!result.ok) {
    if (row && !row.error && row.hospitalizations === 0 && row.unverified === 0) {
      // A hospitalized episode always has a history: none listed that day is a mismatch, not «nothing».
      return outcome('failed', 'No incluida', {
        problem: SELECTION_PROBLEMS.none(formatDateDDMMYYYY(admissionDate)),
      });
    }
    return outcome('failed', 'No incluida', {
      problem: row?.error
        ? `No se pudo consultar Eloísa: ${row.error}`
        : row && row.hospitalizations === 0 && row.unverified > 0
          ? `Eloísa lista ${pluralCount(row.unverified, 'hospitalización', 'hospitalizaciones')} sin fecha o RUT verificable; revísalas allí.`
          : result.error || 'No se pudo descargar la ficha de Eloísa.',
    });
  }
  const selection = archive
    ? selectEpisodeHistory(archive, admissionDate)
    : ({ kind: 'undelivered' } as const);
  if (selection.kind !== 'one') {
    const day = formatDateDDMMYYYY(admissionDate);
    return outcome('failed', 'No incluida', {
      problem:
        selection.kind === 'several'
          ? SELECTION_PROBLEMS.several(day, selection.count)
          : SELECTION_PROBLEMS[selection.kind](day),
    });
  }
  const pdfs = [selection.file];
  const notes = [
    row?.reconstructed
      ? `${pluralCount(row.reconstructed, 'historial tiene', 'historiales tienen')} días que Eloísa no genera, rehechos con su resumen diario y un anexo HHR no oficial.`
      : '',
    row?.incomplete
      ? `${pluralCount(row.incomplete, 'historial queda', 'historiales quedan')} sin parte de un día que Eloísa no genera.`
      : '',
    row?.unverified
      ? `Eloísa lista ${pluralCount(row.unverified, 'hospitalización', 'hospitalizaciones')} sin fecha o RUT verificable; revísalas allí.`
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
      : `${pluralCount(pdfs.length, 'historial', 'historiales')} de hospitalización`;
  // A history with a missing day, or stays Eloísa lists without a verifiable date or RUN, is not the
  // whole record: the person decides whether to download it as it is.
  if ((row?.incomplete ?? 0) > 0 || (row?.unverified ?? 0) > 0) {
    return outcome('partial', summary, {
      documents,
      notes,
      problem: 'La ficha de Eloísa puede estar incompleta (ver notas).',
    });
  }
  return outcome('complete', summary, { documents, notes });
};
