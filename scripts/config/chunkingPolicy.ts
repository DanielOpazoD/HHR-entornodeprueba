// Surviving modules of the former shared clinical-document chunk, measured from
// Rollup's generateBundle metadata before removing the template manager. Keep this
// boundary explicit: the feature also exports contracts used by census startup.
const clinicalDocumentsWorkspaceModules = new Set([
  '/src/features/clinical-documents/components/ClinicalDocumentImageEditor.tsx',
  '/src/features/clinical-documents/components/ClinicalDocumentIndicationsItems.tsx',
  '/src/features/clinical-documents/components/ClinicalDocumentIndicationsPanel.tsx',
  '/src/features/clinical-documents/components/ClinicalDocumentIndicationsPanelHeader.tsx',
  '/src/features/clinical-documents/components/ClinicalDocumentIndicationsTabSettings.tsx',
  '/src/features/clinical-documents/components/ClinicalDocumentPharmacyForms.tsx',
  '/src/features/clinical-documents/components/ClinicalDocumentPlanSection.tsx',
  '/src/features/clinical-documents/components/ClinicalDocumentRichTextEditor.tsx',
  '/src/features/clinical-documents/components/ClinicalDocumentSectionList.tsx',
  '/src/features/clinical-documents/components/ClinicalUpdateDateTimeHeader.tsx',
  '/src/features/clinical-documents/components/InlineEditableTitle.tsx',
  '/src/features/clinical-documents/components/clinicalDocumentSectionRendererRegistry.tsx',
  '/src/features/clinical-documents/contracts/clinicalDocumentAiImportContract.ts',
  '/src/features/clinical-documents/controllers/clinicalDocumentEditorInsertionController.ts',
  '/src/features/clinical-documents/controllers/clinicalDocumentEmptySectionTemplateController.ts',
  '/src/features/clinical-documents/controllers/clinicalDocumentFormattingContract.ts',
  '/src/features/clinical-documents/controllers/clinicalDocumentHtmlSanitizer.ts',
  '/src/features/clinical-documents/controllers/clinicalDocumentImageEditorController.ts',
  '/src/features/clinical-documents/controllers/clinicalDocumentIndentationController.ts',
  '/src/features/clinical-documents/controllers/clinicalDocumentIndicationsCatalogController.ts',
  '/src/features/clinical-documents/controllers/clinicalDocumentIndicationsCatalogModel.ts',
  '/src/features/clinical-documents/controllers/clinicalDocumentIndicationsController.ts',
  '/src/features/clinical-documents/controllers/clinicalDocumentMandatoryListShapeController.ts',
  '/src/features/clinical-documents/controllers/clinicalDocumentPasteController.ts',
  '/src/features/clinical-documents/controllers/clinicalDocumentPlanSectionController.ts',
  '/src/features/clinical-documents/controllers/clinicalDocumentPlanSectionDom.ts',
  '/src/features/clinical-documents/controllers/clinicalDocumentRichTextController.ts',
  '/src/features/clinical-documents/controllers/clinicalDocumentRichTextKeyboardController.ts',
  '/src/features/clinical-documents/controllers/clinicalDocumentSlashCommandController.ts',
  '/src/features/clinical-documents/domain/branding.ts',
  '/src/features/clinical-documents/domain/rules.ts',
  '/src/features/clinical-documents/hooks/useClinicalDocumentEditorHistory.ts',
  '/src/features/clinical-documents/hooks/useClinicalDocumentIndicationsCatalog.ts',
  '/src/features/clinical-documents/hooks/useClinicalDocumentRichTextEditorController.ts',
  '/src/features/clinical-documents/services/clinicalDocumentIndicationsCatalogOperations.ts',
  '/src/features/clinical-documents/services/clinicalDocumentIndicationsCatalogService.ts',
  '/src/features/clinical-documents/services/clinicalDocumentLoggers.ts',
  '/src/features/clinical-documents/services/clinicalDocumentPdfBinarySupport.ts',
  '/src/features/clinical-documents/services/clinicalDocumentPdfRenderService.ts',
  '/src/features/clinical-documents/services/clinicalDocumentPdfSnapshotSupport.ts',
  '/src/features/clinical-documents/services/clinicalDocumentPrintHtmlBuilder.ts',
  '/src/features/clinical-documents/services/clinicalDocumentPrintSupport.ts',
  '/src/features/clinical-documents/styles/clinicalDocumentSheet.css',
  '/src/features/clinical-documents/styles/clinicalDocumentSheet.css?raw',
  '/src/services/firebase-runtime/clinicalAttachmentRuntime.ts',
  '/src/services/repositories/ClinicalAttachmentRepository.ts',
  '/src/shared/clinical-documents/clinicalAttachmentFilePolicy.ts',
  '/src/shared/clinical-documents/clinicalAttachmentPathController.ts',
  '/src/shared/clinical-documents/clinicalAttachmentRuntimeContracts.ts',
]);

export const chunkForModule = (moduleId: string): string | undefined => {
  const normalizedId = moduleId.replace(/\\/g, '/');
  if (
    clinicalDocumentsWorkspaceModules.has(normalizedId.slice(normalizedId.lastIndexOf('/src/')))
  ) {
    return 'clinical-documents-workspace';
  }
  // These dependencies belonged to precached chunks before this workspace split.
  // Reserve their existing owners so Rollup cannot absorb them into an online-only chunk.
  if (
    normalizedId.endsWith('/src/domain/clinical-documents/schema.ts') ||
    normalizedId.endsWith('/src/domain/clinical-documents/definitions.ts')
  )
    return 'census-view';
  if (normalizedId.endsWith('/src/utils/htmlEscape.ts')) return 'htmlEscape';
  const inNodeModules = normalizedId.includes('/node_modules/');
  const has = (fragment: string): boolean => normalizedId.includes(fragment);

  // These visual controls are shared by bootstrap fallbacks and lazy menu owners.
  // Keep their small reusable module separate from the authenticated data runtime.
  if (
    has('/src/components/layout/date-strip/DateStripButtonControls.tsx') ||
    has('/src/components/layout/date-strip/DateStripPeriodControl.tsx') ||
    has('/src/components/layout/date-strip/actions/dateStripActionStateController.ts')
  ) {
    return 'date-strip-controls';
  }

  // Small runtime loaders shared by PDF, image and CUDYR tools. Left to Rollup they
  // landed inside the online-only Rayen reconstruction chunk, so prescriptions, the
  // scanner and every PDF tool depended on it offline. Keep them in their own chunk.
  if (
    has('/src/services/runtime/createCachedRuntimeLoader.ts') ||
    has('/src/services/pdf/pdfJsTextRuntime.ts') ||
    has('/src/services/pdf/pdfTextExtractionRuntime.ts') ||
    has('/src/utils/eloisaPersonName.ts')
  ) {
    return 'shared-runtime-loaders';
  }

  // Historical evidence is online-only, like its structural reconstruction owner.
  // Keep the shared resolver in that existing lazy chunk, outside offline census startup.
  if (
    has('/src/features/rayen-import/domain/enrichReportOnlyDischarges.ts') ||
    has('/src/features/rayen-import/domain/historicalReportEpisodeRecovery.ts') ||
    // Both daily and monthly recovery acquire documentary evidence only while Eloisa is online.
    has('/src/services/cudyr/cudyrMonthlyReportCapture.ts')
  ) {
    return 'replanRayenStructure';
  }

  // The audit download needs Eloísa and the extension online; it stays out of offline startup.
  if (has('/src/features/audit-documents/')) return 'audit-documents';

  if (
    has('/src/components/layout/app-content/AppContentOverlays.tsx') ||
    has('/src/components/layout/app-content/appContentOverlaysController.ts') ||
    has('/src/components/layout/app-content/usePatientSearchShortcut.ts')
  ) {
    return undefined;
  }

  if (
    has('/src/app-shell/runtime/AuthenticatedAppShell.tsx') ||
    has('/src/app-shell/runtime/useAuthenticatedAppRuntime.ts') ||
    has('/src/components/layout/AppContent.tsx') ||
    has('/src/components/layout/app-content/') ||
    has('/src/components/AppProviders.tsx') ||
    has('/src/context/CensusContext.tsx')
  ) {
    return 'app-authenticated-shell';
  }

  if (
    normalizedId.includes('vite/preload-helper') ||
    normalizedId.includes('\u0000vite/preload-helper') ||
    normalizedId.includes('vite/modulepreload-polyfill') ||
    normalizedId.includes('\u0000vite/modulepreload-polyfill')
  ) {
    return 'vendor-preload';
  }

  if (
    normalizedId.includes('commonjsHelpers.js') ||
    normalizedId.includes('\u0000commonjsHelpers.js') ||
    normalizedId.includes('commonjs-dynamic-modules')
  ) {
    return 'vendor-cjs-helpers';
  }

  if (inNodeModules) {
    // Imaging is explicitly opened; keep its renderer, parser and codecs out of census startup.
    if (has('/node_modules/@cornerstonejs/core/')) return 'vendor-dicom-core';
    if (has('/node_modules/@cornerstonejs/tools/')) return 'vendor-dicom-tools';
    if (has('/node_modules/@kitware/')) return 'vendor-dicom-vtk';
    if (has('/node_modules/@cornerstonejs/dicom-image-loader/')) return 'vendor-dicom-loader';
    if (
      has('/node_modules/@cornerstonejs/') ||
      has('/node_modules/dicom-parser/') ||
      has('/node_modules/jpeg-lossless-decoder-js/') ||
      has('/node_modules/gl-matrix/') ||
      has('/node_modules/comlink/')
    )
      return 'vendor-dicom-vtk';
    // React + libraries that call React.createContext at module scope must
    // live in the same chunk to avoid load-order race conditions in production.
    if (
      has('/node_modules/react/') ||
      has('/node_modules/react-dom/') ||
      has('/node_modules/react-error-boundary/') ||
      has('/node_modules/lucide-react/') ||
      has('/node_modules/@tanstack/react-query/') ||
      has('/node_modules/@tanstack/query-core/')
    ) {
      return 'vendor-react';
    }

    if (has('/node_modules/dexie/')) {
      return 'vendor-localdb';
    }

    if (has('/node_modules/zod/')) {
      return 'vendor-zod';
    }

    if (has('/node_modules/firebase/') || has('/node_modules/@firebase/')) {
      if (has('/node_modules/firebase/firestore') || has('/node_modules/@firebase/firestore')) {
        return 'vendor-firebase-firestore';
      }

      if (has('/node_modules/firebase/functions') || has('/node_modules/@firebase/functions')) {
        return 'vendor-firebase-functions';
      }

      if (has('/node_modules/firebase/storage') || has('/node_modules/@firebase/storage')) {
        return 'vendor-firebase-aux';
      }

      // Keep app + auth together. Splitting them created a vendor↔vendor cycle
      // in production (`vendor-firebase-core` <-> `vendor-firebase-auth`) that
      // crashed Netlify before the app could paint.
      return 'vendor-firebase-core';
    }

    if (has('/node_modules/html2canvas/')) {
      return 'vendor-canvas';
    }

    if (has('/node_modules/heic2any/')) {
      return 'vendor-heic2any';
    }

    if (has('/node_modules/pdfjs-dist/')) {
      return 'vendor-pdfjs';
    }

    if (has('/node_modules/exceljs/lib/xlsx/')) {
      return 'vendor-excel-xlsx';
    }
    if (has('/node_modules/exceljs/lib/stream/')) {
      return 'vendor-excel-stream';
    }
    if (has('/node_modules/exceljs/lib/csv/')) {
      return 'vendor-excel-csv';
    }
    if (
      has('/node_modules/jszip/') ||
      has('/node_modules/pako/') ||
      has('/node_modules/crc32-stream/') ||
      has('/node_modules/compress-commons/')
    ) {
      return 'vendor-excel-zip';
    }
    if (
      has('/node_modules/readable-stream/') ||
      has('/node_modules/sax/') ||
      has('/node_modules/saxes/')
    ) {
      return 'vendor-excel-stream';
    }
    if (
      has('/node_modules/archiver/') ||
      has('/node_modules/fast-csv/') ||
      has('/node_modules/dayjs/')
    ) {
      return 'vendor-excel-xml';
    }
    if (has('/node_modules/pdf-lib/')) {
      return 'vendor-pdf-lib';
    }

    if (has('/node_modules/jspdf-autotable/')) {
      return 'vendor-pdf-table';
    }

    if (has('/node_modules/jspdf/')) {
      return 'vendor-pdf-core';
    }

    // jsPDF imports its SVG renderer (canvg, with its core-js polyfills) and DOMPurify only from
    // addSvgAsImage() and html(), which HHR never calls. Unnamed, they became generic chunks
    // (index.es, purify.es) in the install-time precache, although their only importer is the
    // online-only jsPDF chunk. The vendor-pdf- prefix keeps them online-only with jsPDF.
    if (has('/node_modules/canvg/')) {
      return 'vendor-pdf-canvg';
    }

    if (has('/node_modules/dompurify/')) {
      return 'vendor-pdf-purify';
    }
  }

  return undefined;
};
