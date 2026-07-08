export const chunkForModule = (moduleId: string): string | undefined => {
  const normalizedId = moduleId.replace(/\\/g, '/');
  const inNodeModules = normalizedId.includes('/node_modules/');
  const has = (fragment: string): boolean => normalizedId.includes(fragment);

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
    // React + libraries that call React.createContext at module scope must
    // live in the same chunk to avoid load-order race conditions in production.
    if (
      has('/node_modules/react/') ||
      has('/node_modules/react-dom/') ||
      has('/node_modules/lucide-react/') ||
      has('/node_modules/@tanstack/react-query/') ||
      has('/node_modules/@tanstack/query-core/') ||
      has('/node_modules/@tanstack/react-virtual/')
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

      if (
        has('/node_modules/firebase/storage') ||
        has('/node_modules/firebase/functions') ||
        has('/node_modules/@firebase/storage') ||
        has('/node_modules/@firebase/functions')
      ) {
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
  }

  return undefined;
};
