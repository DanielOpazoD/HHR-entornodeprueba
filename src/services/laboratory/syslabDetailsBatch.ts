import type { SyslabDetailsResponse } from '@/types/domain/labExamTypes';

export interface SyslabDetailsOptions {
  onProgress?: (progress: { completed: number; total: number }) => void;
  /** Stops scheduling work after a patient change or closing the viewer. */
  isCurrent?: () => boolean;
}

const DETAILS_BATCH_SIZE = 3;

/** Keep each transport request bounded; only publish a complete, matching selection. */
export const readSyslabDetailsInBatches = async (
  links: string[],
  readBatch: (links: string[]) => Promise<SyslabDetailsResponse>,
  options: SyslabDetailsOptions
): Promise<SyslabDetailsResponse> => {
  const selected = [...new Set(links)];
  const data: SyslabDetailsResponse['data'] = [];
  const assertCurrent = () => {
    if (options.isCurrent && !options.isCurrent()) {
      throw new Error('Análisis cancelado.');
    }
  };
  assertCurrent();
  options.onProgress?.({ completed: 0, total: selected.length });
  for (let offset = 0; offset < selected.length; offset += DETAILS_BATCH_SIZE) {
    assertCurrent();
    const batch = selected.slice(offset, offset + DETAILS_BATCH_SIZE);
    const response = await readBatch(batch);
    assertCurrent();
    if (!response.success) {
      return {
        success: false,
        data: [],
        error: response.error || 'No se pudieron leer todos los informes.',
      };
    }
    const byUrl = new Map(response.data.map(detail => [detail.url, detail]));
    if (
      response.data.length !== batch.length ||
      byUrl.size !== batch.length ||
      batch.some(url => !byUrl.has(url) || byUrl.get(url)?.error)
    ) {
      throw new Error(
        'Syslab devolvió un lote incompleto o inconsistente. No se mostrará un análisis parcial.'
      );
    }
    data.push(...batch.map(url => byUrl.get(url)!));
    options.onProgress?.({ completed: data.length, total: selected.length });
  }
  return { success: true, data };
};
