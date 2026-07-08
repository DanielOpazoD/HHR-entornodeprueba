import type {
  ClinicalDocumentIeehDraft,
  ClinicalDocumentType,
} from '@/features/clinical-documents/domain/entities';
import { getClinicalDocumentDefinition } from '@/features/clinical-documents/domain/definitions';
import { escapeHtml } from '@/utils/htmlEscape';
import {
  applyClinicalDocumentAnnexPrintMode,
  CLINICAL_DOCUMENT_INLINE_PRINT_ROOT_ID,
  CLINICAL_DOCUMENT_INLINE_PRINT_STYLE_ID,
  CLINICAL_DOCUMENT_SHEET_ID,
  type ClinicalDocumentAnnexPrintMode,
  sanitizeClinicalDocumentSheetClone,
} from '@/features/clinical-documents/services/clinicalDocumentPrintSupport';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOCUMENT_TYPES_WITH_PATIENT_SIGNATURE = new Set<ClinicalDocumentType>([
  'epicrisis',
  'epicrisis_traslado',
]);

/** DOM selector for the diagnósticos section editor. */
const DIAGNOSTICOS_SECTION_SELECTOR = '[data-section-editor="diagnosticos"]';

/** CSS class wrapping each section in the sheet. */
const SECTION_WRAPPER_CLASS = '.clinical-document-section-wrapper';

/** Inline style for the CIE-10 print block. */
const CIE10_PRINT_BLOCK_STYLE =
  'margin-top:8px;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;background:#f0fdf4;font-size:11px;color:#15803d';

/** Timeout (ms) to auto-cleanup print DOM after printing. */
const PRINT_CLEANUP_TIMEOUT_MS = 60_000;

/** Delay (ms) before calling window.print to let DOM settle. */
const PRINT_TRIGGER_DELAY_MS = 100;

// ---------------------------------------------------------------------------
// CIE-10 print injection
// ---------------------------------------------------------------------------

/**
 * Injects a CIE-10 block after the diagnósticos section in the print clone.
 * Only called when the epicrisis has an ieehDraft with a code selected.
 * Uses {@link escapeHtml} to prevent XSS from user-provided text.
 */
const injectCie10PrintBlock = (
  sheetClone: HTMLElement,
  ieehDraft: ClinicalDocumentIeehDraft
): void => {
  const diagEditor = sheetClone.querySelector(DIAGNOSTICOS_SECTION_SELECTOR);
  const container = diagEditor?.closest(SECTION_WRAPPER_CLASS) ?? diagEditor?.parentElement;
  if (!container) return;

  const block = document.createElement('div');
  block.style.cssText = CIE10_PRINT_BLOCK_STYLE;
  block.innerHTML = `<strong>CIE-10:</strong> ${escapeHtml(ieehDraft.cie10Code)} — ${escapeHtml(ieehDraft.cie10Description)}`;
  container.appendChild(block);
};

export const openClinicalDocumentBrowserPrintPreview = async (
  pageTitle: string,
  documentType: ClinicalDocumentType = 'epicrisis',
  ieehDraft?: ClinicalDocumentIeehDraft,
  options: {
    annexMode?: ClinicalDocumentAnnexPrintMode;
    includePatientSignature?: boolean;
  } = {}
): Promise<boolean> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  const sheet = document.getElementById(CLINICAL_DOCUMENT_SHEET_ID);
  if (!(sheet instanceof HTMLElement)) {
    return false;
  }

  document.getElementById(CLINICAL_DOCUMENT_INLINE_PRINT_ROOT_ID)?.remove();
  document.getElementById(CLINICAL_DOCUMENT_INLINE_PRINT_STYLE_ID)?.remove();

  const sheetClone = sheet.cloneNode(true) as HTMLElement;
  await sanitizeClinicalDocumentSheetClone(sheet, sheetClone);
  const printableRoot = applyClinicalDocumentAnnexPrintMode(sheetClone, options.annexMode);
  if (!(printableRoot instanceof HTMLElement)) {
    return false;
  }

  // Inject CIE-10 block when printing an epicrisis with IEEH data
  if (ieehDraft?.cie10Code && options.annexMode !== 'annex_only') {
    injectCie10PrintBlock(printableRoot, ieehDraft);
  }

  const printOptions = getClinicalDocumentDefinition(documentType).printOptions;
  const hasAnnex = printableRoot.querySelector('.clinical-document-annex-page') != null;
  const includePatientSignature =
    DOCUMENT_TYPES_WITH_PATIENT_SIGNATURE.has(documentType) &&
    options.includePatientSignature !== false &&
    !hasAnnex &&
    options.annexMode !== 'annex_only';
  const printRoot = document.createElement('div');
  printRoot.id = CLINICAL_DOCUMENT_INLINE_PRINT_ROOT_ID;
  printRoot.innerHTML = includePatientSignature
    ? [
        printableRoot.outerHTML,
        '<div class="clinical-document-print-signature-block" aria-hidden="true">',
        '  <div class="clinical-document-patient-signature-line"></div>',
        '  <div class="clinical-document-patient-signature-label">Firma paciente/familiar responsable</div>',
        '</div>',
      ].join('')
    : printableRoot.outerHTML;

  const printStyle = document.createElement('style');
  printStyle.id = CLINICAL_DOCUMENT_INLINE_PRINT_STYLE_ID;
  printStyle.textContent = `@page { size: ${printOptions.pageSize}; margin: ${printOptions.pageMarginMm}mm; }`;

  const originalTitle = document.title;
  document.title = pageTitle || originalTitle;
  document.head.appendChild(printStyle);
  document.body.appendChild(printRoot);
  document.body.classList.add('clinical-document-inline-print-mode');

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    document.body.classList.remove('clinical-document-inline-print-mode');
    printRoot.remove();
    printStyle.remove();
    document.title = originalTitle;
    window.removeEventListener('afterprint', cleanup);
  };

  window.addEventListener('afterprint', cleanup, { once: true });
  window.setTimeout(cleanup, PRINT_CLEANUP_TIMEOUT_MS);
  window.setTimeout(() => {
    window.print();
  }, PRINT_TRIGGER_DELAY_MS);

  return true;
};
