import {
  WindowLevelTool,
  PanTool,
  ZoomTool,
  TrackballRotateTool,
  LengthTool,
  AngleTool,
  ProbeTool,
  EllipticalROITool,
} from '@cornerstonejs/tools';
import { DicomReferencePointTool } from './dicomReferencePointTool';
import type { DicomTool } from './dicomRuntimeTypes';
/** MPR and navigation tools. Original and Comparar measure with `dicomStackToolName`. */
export const dicomToolNames: Partial<Record<DicomTool, string>> = {
  window: WindowLevelTool.toolName,
  pan: PanTool.toolName,
  zoom: ZoomTool.toolName,
  rotate: TrackballRotateTool.toolName,
  reference: DicomReferencePointTool.toolName,
  length: LengthTool.toolName,
  angle: AngleTool.toolName,
  probe: ProbeTool.toolName,
  roi: EllipticalROITool.toolName,
};
export const dicomMeasureTools: DicomTool[] = [
  'length',
  'angle',
  'cobb',
  'probe',
  'roi',
  'rectangle',
  'circle',
];
