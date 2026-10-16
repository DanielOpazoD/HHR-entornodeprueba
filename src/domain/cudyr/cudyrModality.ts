import type { NeonatalPlacementDecision } from '@/types/domain/neonatalPlacementDecision';

/** Statistical grouping from the original HHR report. Independent of UPC and bed-type overrides. */
export type CudyrStatisticalGroup = 'media' | 'intermedia' | 'sin_grupo';
export type CudyrModality = 'hospitalizacion' | 'cuna' | 'cma' | 'uea' | 'desconocida';

export interface CudyrPlacement {
  bedId: string;
  neonatalPlacementDecision?: NeonatalPlacementDecision;
  sourceBedId?: string;
  bedName?: string;
  bedMode?: string;
  location?: string;
  section?: 'census' | 'crib' | 'discharges' | 'transfers' | 'cma';
  isClinicalCrib?: boolean;
  modality?: CudyrModality;
}

const fold = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

export const cudyrStatisticalGroup = (bedId: string): CudyrStatisticalGroup => {
  const id = fold(bedId).replace(/\s/g, '');
  if (/^R[1-4]$/.test(id)) return 'intermedia';
  if (/^(?:NEO[12]|H[1-6]C[12])$/.test(id)) return 'media';
  return 'sin_grupo';
};

/** All explicitly labelled CMA modalities are excluded, including operating/recovery locations. */
export const cudyrModality = (placement: CudyrPlacement): CudyrModality => {
  if (
    placement.isClinicalCrib ||
    placement.section === 'crib' ||
    fold(placement.bedMode ?? '') === 'CUNA'
  )
    return 'cuna';
  const labels = [placement.location, placement.bedName, placement.bedId, placement.sourceBedId]
    .filter(Boolean)
    .join(' / ');
  const normalized = fold(labels);
  if (
    placement.section === 'cma' ||
    /(?:^|[^A-Z])CMA/.test(normalized) ||
    normalized
      .split('/')
      .some(part => part.includes('QUIRURGICA INDIFERENCIADA') && !part.includes('MEDICO'))
  )
    return 'cma';
  if (
    /(?:^|[^A-Z])(?:B[1-4])?UEA(?:$|[^A-Z])/.test(normalized) ||
    [placement.bedId, placement.bedName, placement.sourceBedId, placement.location].some(value =>
      /^BOX[1-4]$/.test(fold(value || '').replace(/\s/g, ''))
    )
  )
    return 'uea';
  if (placement.modality) return placement.modality;
  if (cudyrStatisticalGroup(placement.bedId) !== 'sin_grupo') return 'hospitalizacion';
  return 'desconocida';
};
