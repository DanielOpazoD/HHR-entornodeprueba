import { downloadBlob } from '@/services/exporters/exportDownload';
import { loadPdfLibGenerationRuntime } from '@/services/pdf/pdfLibRuntime';
import {
  downloadSyslabPdfBundleThroughExtension,
  isSyslabExtensionLink,
} from './syslabExtensionBridge';
import { fetchSyslabPdfArrayBuffer } from './syslabService';
import { buildLabPdfFilename } from './labPdfFilenameController';
import type {
  SyslabExamItem,
  SyslabPdfDownloadProgress,
  SyslabPdfDownloadResult,
} from '@/types/domain/labExamTypes';

const MAX_SELECTED_REPORTS = 24;

const validateLinks = (links: string[]): string[] => {
  const uniqueLinks = [...new Set(links.map(link => link.trim()).filter(Boolean))];
  if (uniqueLinks.length === 0) throw new Error('Selecciona uno o más informes de laboratorio.');
  if (uniqueLinks.length > MAX_SELECTED_REPORTS) {
    throw new Error('Puedes descargar como máximo 24 informes por operación.');
  }
  return uniqueLinks;
};

interface CombinedSyslabPdfRequest {
  exams: SyslabExamItem[];
  rut: string;
  onProgress?: (progress: SyslabPdfDownloadProgress) => void;
}

const downloadLegacyWebBundle = async ({
  exams,
  rut,
  onProgress,
}: CombinedSyslabPdfRequest): Promise<SyslabPdfDownloadResult> => {
  const { PDFDocument } = await loadPdfLibGenerationRuntime();
  const output = await PDFDocument.create();

  for (const [index, exam] of exams.entries()) {
    onProgress?.({
      phase: 'validating',
      completed: index,
      total: exams.length,
      pageCount: output.getPageCount(),
    });
    const source = await PDFDocument.load(await fetchSyslabPdfArrayBuffer(exam.link!));
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach(page => output.addPage(page));
    onProgress?.({
      phase: 'validating',
      completed: index + 1,
      total: exams.length,
      pageCount: output.getPageCount(),
    });
  }

  onProgress?.({
    phase: 'merging',
    completed: exams.length,
    total: exams.length,
    pageCount: output.getPageCount(),
  });
  const bytes = await output.save();
  const filename = buildLabPdfFilename(exams, rut);
  onProgress?.({
    phase: 'downloading',
    completed: exams.length,
    total: exams.length,
    pageCount: output.getPageCount(),
  });
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), filename);
  return { filename, reportCount: exams.length, pageCount: output.getPageCount() };
};

export const downloadCombinedSyslabPdf = async ({
  exams,
  rut,
  onProgress,
}: CombinedSyslabPdfRequest): Promise<SyslabPdfDownloadResult> => {
  const links = exams.map(exam => exam.link || '');
  const validatedLinks = validateLinks(links);
  if (validatedLinks.length !== exams.length) {
    throw new Error('Uno de los informes seleccionados no está disponible. Actualiza la búsqueda.');
  }
  const extensionLinks = validatedLinks.filter(isSyslabExtensionLink);

  if (extensionLinks.length === validatedLinks.length) {
    return downloadSyslabPdfBundleThroughExtension(extensionLinks, onProgress);
  }
  if (extensionLinks.length > 0) {
    throw new Error('Actualiza el visor antes de descargar informes de orígenes distintos.');
  }

  return downloadLegacyWebBundle({ exams, rut, onProgress });
};
