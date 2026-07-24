import type { DocumentScanFilterMode } from './documentImageFilters';
import {
  getDocumentPage,
  moveDocumentPage as movePageInCollection,
  removeDocumentPage as removePageFromCollection,
} from './documentPageCollection';
import { filterDocumentPage, processDocumentPage } from './jscanifyWorkerRuntime';
import type {
  DocumentCropEditorState,
  DocumentPageThumbnail,
  DocumentScanCorners,
  DocumentScanPoint,
  JscanifyDocumentPage,
  JscanifyDocumentPreview,
  JscanifyDocumentSession,
} from './documentScannerTypes';

export { mapScannerLuminance } from './documentImageFilters';
export type { DocumentScanFilterMode } from './documentImageFilters';
export { computeSha384Integrity, JSCANIFY_POC_METADATA } from './jscanifyWorkerRuntime';
export type {
  DocumentCropEditorState,
  DocumentPageThumbnail,
  DocumentScanCorners,
  DocumentScanPoint,
  JscanifyDocumentPage,
  JscanifyDocumentPreview,
  JscanifyDocumentSession,
} from './documentScannerTypes';

const MAX_PAGE_COUNT = 12;
const MAX_OUTPUT_DIMENSION = 2200;
const A4_RATIO = Math.SQRT2;
export const DOCUMENT_UPLOAD_SOURCE_BUDGET_BYTES = Math.floor(4.75 * 1024 * 1024);
const UPLOAD_QUALITY_STEPS = [0.82, 0.7, 0.58, 0.46] as const;
const UPLOAD_SCALE_STEPS = [1, 0.85, 0.7, 0.58, 0.48] as const;

export const getDocumentOutputDimensions = (
  width: number,
  height: number
): { width: number; height: number } =>
  height >= width
    ? { width: Math.round(MAX_OUTPUT_DIMENSION / A4_RATIO), height: MAX_OUTPUT_DIMENSION }
    : { width: MAX_OUTPUT_DIMENSION, height: Math.round(MAX_OUTPUT_DIMENSION / A4_RATIO) };

export const createJscanifyDocumentSession = async (
  files: ReadonlyArray<File>
): Promise<JscanifyDocumentSession> => {
  if (!files.length) throw new Error('Selecciona al menos una fotografía del documento.');
  if (files.length > MAX_PAGE_COUNT) {
    throw new Error(`Puedes procesar un máximo de ${MAX_PAGE_COUNT} páginas por documento.`);
  }
  const pages: JscanifyDocumentPage[] = [];
  for (const file of files) pages.push(await processDocumentPage(file));
  return { pages };
};

export const appendJscanifyDocumentPages = async (
  session: JscanifyDocumentSession,
  files: ReadonlyArray<File>
): Promise<number> => {
  if (!files.length) throw new Error('Selecciona al menos una fotografía del documento.');
  if (session.pages.length + files.length > MAX_PAGE_COUNT) {
    const remainingPages = Math.max(0, MAX_PAGE_COUNT - session.pages.length);
    throw new Error(
      remainingPages === 0
        ? `El documento ya alcanzó el máximo de ${MAX_PAGE_COUNT} páginas.`
        : `Puedes agregar hasta ${remainingPages} ${remainingPages === 1 ? 'página' : 'páginas'} más.`
    );
  }

  const firstAddedPageIndex = session.pages.length;
  const pages: JscanifyDocumentPage[] = [];
  for (const file of files) pages.push(await processDocumentPage(file));
  session.pages.push(...pages);
  return firstAddedPageIndex;
};

const renderFilteredPage = async (
  page: JscanifyDocumentPage,
  mode: DocumentScanFilterMode,
  maximumDimension?: number
): Promise<HTMLCanvasElement> => {
  const filteredBlob = await filterDocumentPage(page.blob, mode, maximumDimension);
  const bitmap = await createImageBitmap(filteredBlob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo aplicar la apariencia seleccionada.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
};

export const createDocumentCropEditorState = (
  session: JscanifyDocumentSession,
  pageIndex: number
): DocumentCropEditorState => ({
  sourceObjectUrl: URL.createObjectURL(getDocumentPage(session, pageIndex).sourceBlob),
  corners: getDocumentPage(session, pageIndex).corners,
});

export const applyDocumentScanCrop = async (
  session: JscanifyDocumentSession,
  pageIndex: number,
  corners: DocumentScanCorners
): Promise<void> => {
  const currentPage = getDocumentPage(session, pageIndex);
  const page = await processDocumentPage(currentPage.sourceBlob, corners);
  page.sourceBlob = currentPage.sourceBlob;
  page.filterMode = currentPage.filterMode;
  session.pages[pageIndex] = page;
};

export const redetectDocumentScanPage = async (
  session: JscanifyDocumentSession,
  pageIndex: number
): Promise<void> => {
  const currentPage = getDocumentPage(session, pageIndex);
  const page = await processDocumentPage(currentPage.sourceBlob);
  page.sourceBlob = currentPage.sourceBlob;
  page.filterMode = currentPage.filterMode;
  session.pages[pageIndex] = page;
};

const canvasToBlob = (canvas: HTMLCanvasElement, quality = 0.88): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('No se pudo generar la imagen procesada.'))),
      'image/jpeg',
      quality
    );
  });

const encodeCanvasWithinBudget = async (
  source: HTMLCanvasElement,
  maximumBytes: number
): Promise<ArrayBuffer> => {
  for (const scale of UPLOAD_SCALE_STEPS) {
    const canvas =
      scale === 1
        ? source
        : Object.assign(document.createElement('canvas'), {
            width: Math.max(1, Math.round(source.width * scale)),
            height: Math.max(1, Math.round(source.height * scale)),
          });
    if (canvas !== source) {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No se pudo preparar la página para subirla.');
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
    }
    try {
      for (const quality of UPLOAD_QUALITY_STEPS) {
        const blob = await canvasToBlob(canvas, quality);
        if (blob.size <= maximumBytes) return await blob.arrayBuffer();
      }
    } finally {
      if (canvas !== source) {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  }
  throw new Error(
    'Las páginas contienen demasiado detalle para la carga segura. Divide el documento en dos escaneos.'
  );
};

export const applyDocumentScanFilter = async (
  session: JscanifyDocumentSession,
  pageIndex: number,
  mode: DocumentScanFilterMode
): Promise<void> => {
  const page = getDocumentPage(session, pageIndex);
  page.filterMode = mode;
};

export const createDocumentScanPreview = async (
  session: JscanifyDocumentSession,
  pageIndex: number
): Promise<JscanifyDocumentPreview> => {
  const page = getDocumentPage(session, pageIndex);
  const canvas = await renderFilteredPage(page, page.filterMode);
  try {
    const blob = await canvasToBlob(canvas);
    return {
      objectUrl: URL.createObjectURL(blob),
      pageCount: session.pages.length,
      detectedPageCount: session.pages.filter(page => page.paperDetected).length,
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
};

export const createDocumentPageThumbnails = async (
  session: JscanifyDocumentSession
): Promise<DocumentPageThumbnail[]> => {
  const thumbnailBlobs: Array<{ pageIndex: number; blob: Blob }> = [];
  for (let pageIndex = 0; pageIndex < session.pages.length; pageIndex += 1) {
    const page = session.pages[pageIndex];
    const canvas = await renderFilteredPage(page, page.filterMode, 160);
    try {
      thumbnailBlobs.push({ pageIndex, blob: await canvasToBlob(canvas, 0.8) });
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  return thumbnailBlobs.map(({ pageIndex, blob }) => ({
    pageIndex,
    objectUrl: URL.createObjectURL(blob),
  }));
};

const rotateBlobClockwise = async (blob: Blob): Promise<Blob> => {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.height;
    canvas.height = bitmap.width;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo rotar la página.');
    context.translate(canvas.width, 0);
    context.rotate(Math.PI / 2);
    context.drawImage(bitmap, 0, 0);
    try {
      return await canvasToBlob(canvas);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    bitmap.close();
  }
};

const rotateCornersClockwise = (corners: DocumentScanCorners): DocumentScanCorners => {
  const rotate = ({ x, y }: DocumentScanPoint): DocumentScanPoint => ({ x: 1 - y, y: x });
  return {
    topLeftCorner: rotate(corners.bottomLeftCorner),
    topRightCorner: rotate(corners.topLeftCorner),
    bottomLeftCorner: rotate(corners.bottomRightCorner),
    bottomRightCorner: rotate(corners.topRightCorner),
  };
};

export const rotateDocumentScanPage = async (
  session: JscanifyDocumentSession,
  pageIndex: number
): Promise<void> => {
  const page = getDocumentPage(session, pageIndex);
  const [blob, sourceBlob] = await Promise.all([
    rotateBlobClockwise(page.blob),
    rotateBlobClockwise(page.sourceBlob),
  ]);
  session.pages[pageIndex] = {
    ...page,
    blob,
    sourceBlob,
    corners: rotateCornersClockwise(page.corners),
  };
};

export const reorderDocumentScanPage = (
  session: JscanifyDocumentSession,
  pageIndex: number,
  destinationIndex: number
): number => movePageInCollection(session, pageIndex, destinationIndex);

export const deleteDocumentScanPage = (
  session: JscanifyDocumentSession,
  pageIndex: number
): number => removePageFromCollection(session, pageIndex);

export const getDocumentScanPageFilter = (
  session: JscanifyDocumentSession,
  pageIndex: number
): DocumentScanFilterMode => getDocumentPage(session, pageIndex).filterMode;

export const createDocumentScanPdf = async (
  session: JscanifyDocumentSession
): Promise<ArrayBuffer> => {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 6;

  for (let index = 0; index < session.pages.length; index += 1) {
    if (index > 0) pdf.addPage('a4', 'portrait');
    const page = session.pages[index];
    const canvas = await renderFilteredPage(page, page.filterMode);
    try {
      const scale = Math.min(
        (pageWidth - margin * 2) / canvas.width,
        (pageHeight - margin * 2) / canvas.height
      );
      const width = canvas.width * scale;
      const height = canvas.height * scale;
      pdf.addImage(
        canvas.toDataURL('image/jpeg', 0.88),
        'JPEG',
        (pageWidth - width) / 2,
        (pageHeight - height) / 2,
        width,
        height,
        undefined,
        'FAST'
      );
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  return pdf.output('arraybuffer');
};

export const createDocumentScanUploadImages = async (
  session: JscanifyDocumentSession
): Promise<ArrayBuffer[]> => {
  const images: ArrayBuffer[] = [];
  let usedBytes = 0;
  for (let index = 0; index < session.pages.length; index += 1) {
    const page = session.pages[index];
    const canvas = await renderFilteredPage(page, page.filterMode);
    try {
      const remainingPages = session.pages.length - index;
      const pageBudget = Math.floor(
        (DOCUMENT_UPLOAD_SOURCE_BUDGET_BYTES - usedBytes) / remainingPages
      );
      const image = await encodeCanvasWithinBudget(canvas, pageBudget);
      images.push(image);
      usedBytes += image.byteLength;
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  return images;
};

export const disposeDocumentScanSession = async (
  _session: JscanifyDocumentSession | null
): Promise<void> => undefined;

export const revokeDocumentScanPreview = (objectUrl: string | null): void => {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
};
