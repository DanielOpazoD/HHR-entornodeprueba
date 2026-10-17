import { init as initCore, cache } from '@cornerstonejs/core';
import { init as initLoader } from '@cornerstonejs/dicom-image-loader';
import {
  init as initTools,
  addTool,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  StackScrollTool,
  TrackballRotateTool,
} from '@cornerstonejs/tools';
import { mprTools } from './dicomMprTools';

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
    await initCore();
    initLoader({ maxWebWorkers: 2 });
    initTools();
    [...dicomTools, ...mprTools].forEach(tool => addTool(tool));
    cache.setMaxCacheSize(512 * 1024 * 1024);
  })().catch((error: unknown) => {
    initialization = undefined;
    throw error;
  }));
