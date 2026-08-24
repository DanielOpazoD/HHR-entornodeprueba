import { downloadBlob } from '@/services/exporters/exportDownload';
import { loadPdfLibGenerationRuntime } from '@/services/pdf/pdfLibRuntime';
import {
  downloadSyslabPdfBundleThroughExtension,
  isSyslabExtensionLink,
} from './syslabExtensionBridge';
import { fetchSyslabPdfArrayBuffer } from './syslabService';

const MAX_SELECTED_REPORTS = 24;
const BUNDLE_FILENAME = 'Examenes_Syslab_seleccionados.pdf';

const validateLinks = (links: string[]): string[] => {
  const uniqueLinks = [...new Set(links.map(link => link.trim()).filter(Boolean))];
  if (uniqueLinks.length === 0) throw new Error('Selecciona uno o más informes de laboratorio.');
  if (uniqueLinks.length > MAX_SELECTED_REPORTS) {
    throw new Error('Puedes descargar como máximo 24 informes por operación.');
  }
  return uniqueLinks;
};

const downloadLegacyWebBundle = async (links: string[]): Promise<void> => {
  const { PDFDocument } = await loadPdfLibGenerationRuntime();
  const output = await PDFDocument.create();

  for (const link of links) {
    const source = await PDFDocument.load(await fetchSyslabPdfArrayBuffer(link));
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach(page => output.addPage(page));
  }

  const bytes = await output.save();
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), BUNDLE_FILENAME);
};

export const downloadCombinedSyslabPdf = async (links: string[]): Promise<void> => {
  const validatedLinks = validateLinks(links);
  const extensionLinks = validatedLinks.filter(isSyslabExtensionLink);

  if (extensionLinks.length === validatedLinks.length) {
    await downloadSyslabPdfBundleThroughExtension(extensionLinks);
    return;
  }
  if (extensionLinks.length > 0) {
    throw new Error('Actualiza el visor antes de descargar informes de orígenes distintos.');
  }

  await downloadLegacyWebBundle(validatedLinks);
};
