import type { DataSet } from 'dicom-parser';

/** DICOM PS3.3 C.8.2.1.1.1: only classic CT defines LOCALIZER in Image Type value 3.
 * Never infer exclusion from orientation, dimensions, names or minority membership.
 * The caller must verify identity and single-frame limits before using this classification.
 */
export const isDicomCtLocalizer = (data: Pick<DataSet, 'string'>): boolean =>
  data.string('x00080016') === '1.2.840.10008.5.1.4.1.1.2' &&
  data.string('x00080060') === 'CT' &&
  data.string('x00080008')?.split('\\')[2]?.trim() === 'LOCALIZER';
