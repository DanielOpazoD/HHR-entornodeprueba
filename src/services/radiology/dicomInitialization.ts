import { init as initCore, cache, getConfiguration } from '@cornerstonejs/core';
import { init as initLoader } from '@cornerstonejs/dicom-image-loader';
import {
  init as initTools,
  addTool,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  StackScrollTool,
} from '@cornerstonejs/tools';
import { DicomTrackballRotateTool as TrackballRotateTool } from './dicomTrackballRotateTool';
import { mprTools } from './dicomMprTools';
import { dicomStackTools } from './dicomStackTools';
import { installDicomCalibration } from './dicomCalibration';

export const dicomTools = [
  WindowLevelTool,
  PanTool,
  ZoomTool,
  StackScrollTool,
  TrackballRotateTool,
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
