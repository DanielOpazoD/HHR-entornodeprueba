/**
 * The heavy half of the explorer download, loaded only when a person presses «Descargar»: the
 * Eloísa bridge, and the PDF and ZIP libraries that read the history, write the Syslab results and
 * the CT report text, and join or pack everything. Nothing here is kept or sent anywhere.
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import PizZip from 'pizzip';
import type { MMRADExam } from '@/services/radiology/mmradService';
import { loadPdfLibGenerationRuntime } from '@/services/pdf/pdfLibRuntime';
import { formatMmradStamp } from '@/services/radiology/mmradStamp';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import {
  describeRange,
  zipEntryNames,
  type HistoryArchive,
  type DownloadDocument,
  type DownloadRange,
  type LabReportGroup,
} from './clinicalExplorerDownloadModel';
import { parseHistorySummary } from './clinicalExplorerDownloadScope';

export { requestAuditDocuments } from '@/features/audit-documents/eloisa-history';
// The version tells whether the extension hands the ZIP to this page or saves it into Downloads.
export { requestRayenExtensionHealth } from '@/features/rayen-import/clinical-panel';

const MARGIN = 14;
/**
 * Helvetica in jsPDF prints Latin-1 only: other characters vanish or turn into stray bytes (the en
 * dash of a measured range disappears and «5 to 10 mm» reads «510 mm»). Known symbols are spelled
 * the way a person would type them; anything else outside Latin-1 shows as «?», never dropped.
 */
const PDF_TEXT_SUBSTITUTES: Readonly<Record<string, string>> = {
  '\u2010': '-',
  '\u2011': '-',
  '\u2013': '-',
  '\u2014': '-',
  '\u2212': '-',
  '\u2022': '-',
  '\u2264': '<=',
  '\u2265': '>=',
  '\u2190': '<-',
  '\u2192': '->',
  '\u2018': "'",
  '\u2019': "'",
  '\u201a': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u201e': '"',
  '\u2026': '...',
  '\u03bc': '\u00b5',
  '\u2009': ' ',
  '\u202f': ' ',
  '\u200b': '',
};
const SUPERSCRIPT_DIGITS = '\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079';
export const printable = (value: string): string =>
  value.replace(/[^\x00-\xff]/gu, char => {
    const digit = SUPERSCRIPT_DIGITS.indexOf(char);
    return PDF_TEXT_SUBSTITUTES[char] ?? (digit >= 0 ? `^${digit}` : '?');
  });

/** The bytes of a Blob; FileReader where `Blob.arrayBuffer` is missing, as in older engines. */
export const readBlobBytes = async (blob: Blob): Promise<Uint8Array> => {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo.'));
    reader.onload = () =>
      reader.result instanceof ArrayBuffer
        ? resolve(new Uint8Array(reader.result))
        : reject(new Error('El archivo no se leyó como bytes.'));
    reader.readAsArrayBuffer(blob);
  });
};

/** The PDFs of the extension's ZIP, in name order (the name ends with the admission day). */
export const readHistoryArchive = async (archive: Blob): Promise<HistoryArchive> => {
  const zip = new PizZip(await readBlobBytes(archive));
  const entries = Object.values(zip.files).filter(file => !file.dir);
  const summary = entries.find(file => /(^|\/)00 resumen\.csv$/i.test(file.name));
  return {
    files: entries
      .filter(file => /\.pdf$/i.test(file.name))
      .map(file => ({ name: file.name, bytes: file.asUint8Array() }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    stays: summary ? parseHistorySummary(new TextDecoder().decode(summary.asUint8Array())) : null,
  };
};

interface PatientHeading {
  patientName: string;
  rut: string;
  /** Hospital clock, "DD-MM-YYYY HH:MM". */
  generatedAt: string;
}

const writeFooter = (doc: jsPDF, text: string): void => {
  const pages = doc.getNumberOfPages();
  const height = doc.internal.pageSize.getHeight();
  const width = doc.internal.pageSize.getWidth() - MARGIN * 2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.text(doc.splitTextToSize(text, width - 20) as string[], MARGIN, height - 10);
    doc.text(`${page} / ${pages}`, MARGIN + width, height - 10, { align: 'right' });
  }
};

const writeHeading = (doc: jsPDF, title: string, lines: string[]): number => {
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(printable(title), MARGIN, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  lines.forEach((line, index) => doc.text(printable(line), MARGIN, 24 + index * 5));
  return 24 + lines.length * 5 + 2;
};

const pdfBytes = (doc: jsPDF): Uint8Array => new Uint8Array(doc.output('arraybuffer'));

/** The results as Syslab reported them, one block per report, oldest first. */
export const renderLabResultsPdf = ({
  patientName,
  rut,
  generatedAt,
  range,
  groups,
}: PatientHeading & { range: DownloadRange; groups: LabReportGroup[] }): Uint8Array => {
  const doc = new jsPDF({ format: 'a4', unit: 'mm', compress: true });
  const startY = writeHeading(doc, 'Exámenes de laboratorio · Syslab', [
    `${patientName} · RUT ${rut}`,
    `Informes ${describeRange(range)} · ${groups.length} ${groups.length === 1 ? 'informe' : 'informes'}`,
  ]);
  autoTable(doc, {
    startY,
    head: [['Examen', 'Resultado', 'Unidad', 'Referencia']],
    body: groups.flatMap(group => [
      [
        {
          content: `${formatDateDDMMYYYY(group.dayIso)}${group.time ? ` ${group.time}` : ''}`,
          colSpan: 4,
          styles: { fontStyle: 'bold', fillColor: [241, 245, 249] },
        },
      ],
      ...group.rows.map(row => [
        printable(row.name),
        printable(row.display),
        printable(row.unit),
        printable(row.refValue),
      ]),
    ]),
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 1.2, textColor: [30, 41, 59] },
    headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255] },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: MARGIN, right: MARGIN, bottom: 18 },
  });
  writeFooter(
    doc,
    `Valores tal como los informa Syslab, sin interpretar. Resumen preparado por HHR el ${generatedAt} (hora de Rapa Nui); no reemplaza los informes oficiales de Syslab.`
  );
  return pdfBytes(doc);
};

/** The text of a CT report MMRAD published without its original PDF. */
export const renderCtReportTextPdf = ({
  patientName,
  rut,
  generatedAt,
  exam,
}: PatientHeading & { exam: MMRADExam }): Uint8Array => {
  const doc = new jsPDF({ format: 'a4', unit: 'mm', compress: true });
  const report = exam.report;
  let y = writeHeading(doc, report?.title?.trim() || exam.nombre_examen, [
    `${patientName} · RUT ${rut}`,
    `${exam.nombre_examen} · ${formatMmradStamp(exam.fecha_examen)}`,
  ]);
  const width = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const bottom = doc.internal.pageSize.getHeight() - 22;
  const sections: Array<[string, string | null | undefined]> = [
    ['Técnica', report?.technique],
    ['Hallazgos', report?.findings],
    ['Impresión', report?.impression],
  ];
  for (const [label, text] of sections) {
    if (!text?.trim()) continue;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    if (y > bottom) {
      doc.addPage();
      y = 18;
    }
    doc.text(label, MARGIN, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    for (const line of doc.splitTextToSize(printable(text.trim()), width) as string[]) {
      if (y > bottom) {
        doc.addPage();
        y = 18;
      }
      doc.text(line, MARGIN, y);
      y += 4.6;
    }
    y += 3;
  }
  writeFooter(
    doc,
    `Texto del informe publicado por MMRAD, que no entregó el PDF original de este estudio. Preparado por HHR el ${generatedAt} (hora de Rapa Nui).`
  );
  return pdfBytes(doc);
};

/** A document pdf-lib cannot read stops the join; the message names it. */
export class DownloadAssemblyError extends Error {}

/** Every document, in the order given, as one PDF. */
export const mergePdfDocuments = async (
  documents: readonly DownloadDocument[]
): Promise<Uint8Array> => {
  const { PDFDocument } = await loadPdfLibGenerationRuntime();
  const output = await PDFDocument.create();
  for (const document of documents) {
    const source = await PDFDocument.load(document.bytes).catch(() => {
      throw new DownloadAssemblyError(
        `No se pudo leer «${document.fileName}» para unirlo. Elige «Archivos separados (ZIP)».`
      );
    });
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach(page => output.addPage(page));
  }
  return output.save();
};

/** Every document as its own file, numbered by part. */
export const zipDocuments = (documents: readonly DownloadDocument[]): Uint8Array => {
  const zip = new PizZip();
  const names = zipEntryNames(documents);
  documents.forEach((document, index) => {
    zip.file(names[index] ?? document.fileName, document.bytes, { binary: true });
  });
  return zip.generate({ type: 'uint8array', compression: 'DEFLATE' });
};
