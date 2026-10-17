import type { DataSet } from 'dicom-parser';

/** Enhanced objects may hide calibration inside shared/per-frame functional groups,
 * even with NumberOfFrames=1. Until those mappings are supported, keep them in Original.
 */
export const supportsDicomResampling = (data: DataSet): boolean =>
  !['x00280120', 'x00280121', 'x00283000', 'x00409096', 'x52009229', 'x52009230'].some(
    tag => data.elements[tag]
  );
