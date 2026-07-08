import { createCachedRuntimeLoader } from '@/services/runtime/createCachedRuntimeLoader';

const resolvePdfLibGenerationRuntime = (): Promise<typeof import('pdf-lib')> => import('pdf-lib');

export const loadPdfLibGenerationRuntime = createCachedRuntimeLoader(
  resolvePdfLibGenerationRuntime
);
