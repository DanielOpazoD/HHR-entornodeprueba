/**
 * PDF Base Utilities
 *
 * Common functions for PDF manipulation using pdf-lib.
 */
import type { PDFDocument } from 'pdf-lib';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { loadPdfLibGenerationRuntime } from '@/services/pdf/pdfLibRuntime';

const RESERVED_WINDOW_PRINT_DELAY_MS = 450;
const IFRAME_PRINT_DELAY_MS = 250;
const IFRAME_FALLBACK_TIMEOUT_MS = 4000;
const PDF_OBJECT_URL_TTL_MS = 60000;

const revokeObjectUrlLater = (url: string): void => {
  window.setTimeout(() => URL.revokeObjectURL(url), PDF_OBJECT_URL_TTL_MS);
};

const scheduleDownloadFallback = (
  pdfBytes: Uint8Array,
  fallbackName: string,
  url: string
): void => {
  const popup = defaultBrowserWindowRuntime.open(url, '_blank');
  if (!popup) {
    void saveAndDownloadPdf(pdfBytes, fallbackName);
    URL.revokeObjectURL(url);
    return;
  }

  revokeObjectUrlLater(url);
};

const createHiddenPrintFrame = (): HTMLIFrameElement => {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.position = 'fixed';
  iframe.style.width = '1px';
  iframe.style.height = '1px';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.opacity = '0.01';
  iframe.style.pointerEvents = 'none';
  iframe.style.border = '0';
  return iframe;
};

/**
 * Injects a JavaScript auto-print action into the PDF catalog.
 */
export const injectPrintScript = async (pdfDoc: PDFDocument): Promise<void> => {
  const { PDFName } = await loadPdfLibGenerationRuntime();

  pdfDoc.catalog.set(
    PDFName.of('OpenAction'),
    pdfDoc.context.obj({
      Type: 'Action',
      S: 'JavaScript',
      JS: 'this.print({bUI: true, bSilent: false, bShrinkToFit: true});',
    })
  );
};

/**
 * Saves and triggers a browser download for a PDF document.
 * Supports File System Access API (Save As) with fallback.
 */
export const saveAndDownloadPdf = async (
  pdfSource: PDFDocument | Uint8Array,
  suggestedName: string
): Promise<void> => {
  const { PDFDocument } = await loadPdfLibGenerationRuntime();
  const pdfBytes: Uint8Array =
    pdfSource instanceof PDFDocument ? await pdfSource.save() : pdfSource;

  // Try native Save As dialog
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (
        window as unknown as {
          showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle>;
        }
      ).showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: 'PDF Document',
            accept: { 'application/pdf': ['.pdf'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(pdfBytes as unknown as BufferSource);
      await writable.close();
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }

  // Fallback: classic download link
  const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = suggestedName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/**
 * Opens the browser print dialog for a generated PDF without forcing a file download.
 */
export const openPdfPrintDialog = async (
  pdfSource: PDFDocument | Uint8Array,
  fallbackName: string,
  reservedPrintWindow?: Window | null
): Promise<void> => {
  const { PDFDocument } = await loadPdfLibGenerationRuntime();
  const pdfBytes: Uint8Array =
    pdfSource instanceof PDFDocument ? await pdfSource.save() : pdfSource;
  const printDoc = await PDFDocument.load(pdfBytes);
  await injectPrintScript(printDoc);
  const finalBytes = await printDoc.save();
  const blob = new Blob([finalBytes as unknown as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const iframe = createHiddenPrintFrame();
  let hasResolvedFallback = false;

  const removeIframe = () => {
    iframe.remove();
  };

  const cleanup = () => {
    removeIframe();
    URL.revokeObjectURL(url);
  };

  const finalizeReservedWindow = () => {
    if (!reservedPrintWindow) {
      return;
    }

    reservedPrintWindow.location.href = url;
    reservedPrintWindow.focus();
    window.setTimeout(() => {
      try {
        reservedPrintWindow.print();
      } catch {
        // Ignore print failures and keep browser-native PDF controls as fallback.
      }
    }, RESERVED_WINDOW_PRINT_DELAY_MS);
    revokeObjectUrlLater(url);
  };

  try {
    if (reservedPrintWindow) {
      finalizeReservedWindow();
      return;
    }

    const fallbackTimeout = window.setTimeout(() => {
      hasResolvedFallback = true;
      removeIframe();
      scheduleDownloadFallback(finalBytes as Uint8Array, fallbackName, url);
    }, IFRAME_FALLBACK_TIMEOUT_MS);

    iframe.addEventListener(
      'load',
      () => {
        window.clearTimeout(fallbackTimeout);
        try {
          const frameWindow = iframe.contentWindow;

          if (frameWindow && typeof frameWindow.print === 'function') {
            frameWindow.focus();
            window.setTimeout(() => frameWindow.print(), IFRAME_PRINT_DELAY_MS);
          }
        } catch {
          if (!hasResolvedFallback) {
            hasResolvedFallback = true;
            removeIframe();
            scheduleDownloadFallback(finalBytes as Uint8Array, fallbackName, url);
            return;
          }
        }

        window.setTimeout(cleanup, PDF_OBJECT_URL_TTL_MS);
      },
      { once: true }
    );

    iframe.src = url;
    document.body.appendChild(iframe);
    return;
  } catch {
    cleanup();
  }

  scheduleDownloadFallback(finalBytes as Uint8Array, fallbackName, url);
};
