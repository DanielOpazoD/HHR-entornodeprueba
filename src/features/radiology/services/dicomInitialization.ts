import { init as initCore, cache, getConfiguration } from '@cornerstonejs/core';
import { init as initLoader } from '@cornerstonejs/dicom-image-loader';
import {
  init as initTools,
  addTool,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  StackScrollTool,
  TrackballRotateTool as BaseTrackballRotateTool,
} from '@cornerstonejs/tools';
import { mprTools } from './dicomMprTools';
import { dicomStackTools } from './dicomStackTools';
import { installDicomCalibration } from './dicomCalibration';

/** Viewport sizing belongs to our world-position-preserving observer, not a camera reset. */
class DicomTrackballRotateTool extends BaseTrackballRotateTool {
  constructor(...args: ConstructorParameters<typeof BaseTrackballRotateTool>) {
    super(...args);
    // Core tools 4.22 installs resize/global viewport listeners here, including for later
    // groups reusing the same id. Their resetCamera loses the reviewed slice/orientation.
    this.onSetToolActive = () => {};
    const disable = this.onSetToolDisabled;
    this.onSetToolDisabled = () => {
      disable.call(this);
      if (this.cleanUp) {
        document.removeEventListener('mouseup', this.cleanUp);
        this.cleanUp();
      }
    };
  }
}

export const dicomTools = [
  WindowLevelTool,
  PanTool,
  ZoomTool,
  StackScrollTool,
  DicomTrackballRotateTool,
];
let initialization: Promise<void> | undefined;
export const initializeDicom = () =>
  (initialization ??= (async () => {
    const config = getConfiguration();
    await initCore({ ...config, rendering: { ...config.rendering, webGlContextCount: 1 } });
    initLoader({ maxWebWorkers: 2 });
    initTools();
    [...dicomTools, ...mprTools, ...dicomStackTools].forEach(tool => addTool(tool));
    installDicomCalibration();
    cache.setMaxCacheSize(512 * 1024 * 1024);
  })().catch((error: unknown) => {
    initialization = undefined;
    throw error;
  }));
