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
export const dicomToolNames: Record<DicomTool, string> = {
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
