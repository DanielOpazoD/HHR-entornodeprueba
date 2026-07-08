import { createCachedRuntimeLoader } from '@/services/runtime/createCachedRuntimeLoader';

const resolvePdfJsTextRuntime = async (): Promise<
  typeof import('pdfjs-dist/legacy/build/pdf.mjs')
> => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url
  ).toString();
  return pdfjs;
};

export const loadPdfJsTextRuntime = createCachedRuntimeLoader(resolvePdfJsTextRuntime);
