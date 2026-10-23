import { getWebWorkerManager, utilities } from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
let users = 0;
/** Global loader resources outlive individual series until the last session has drained. */
export const retainDicomRuntime = () => {
  users++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--users) return;
    if (getWebWorkerManager().workerRegistry.dicomImageLoader)
      getWebWorkerManager().terminate('dicomImageLoader');
    utilities.genericMetadataProvider.clear();
    wadouri.fileManager.purge();
    wadouri.dataSetCacheManager.purge();
  };
};
