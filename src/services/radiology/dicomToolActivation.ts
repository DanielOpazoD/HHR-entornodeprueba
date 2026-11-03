import { dicomMeasureTools, dicomToolNames as toolNames } from './dicomToolNames';
import { dicomTools as tools } from './dicomInitialization';
import {
  ToolGroupManager,
  ZoomTool,
  StackScrollTool,
  Enums as ToolEnums,
  CrosshairsTool,
  LengthTool,
  AngleTool,
  ProbeTool,
  EllipticalROITool,
} from '@cornerstonejs/tools';
import { DicomReferencePointTool } from './dicomReferencePointTool';
import type { createMprTools, ReferenceStyle } from './dicomMprTools';
import type { createMprReconstruction } from './dicomMprReconstruction';
import type { DicomMode, DicomTool } from './dicomRuntimeTypes';
import { dicomStackToolName, dicomStackTools, type DicomStackToolSession } from './dicomStackTools';

/** MPR keeps its four tools; Cobb and the rectangular and circular ROIs are Original only. */
const availableIn = (tool: DicomTool, mode: DicomMode) => {
  if (mode === '3d') return !dicomMeasureTools.includes(tool) && tool !== 'reference';
  if (mode === 'original') return tool !== 'reference' && tool !== 'rotate';
  return !['cobb', 'rectangle', 'circle'].includes(tool);
};

export const activateDicomTool = (
  tool: DicomTool,
  context: {
    group: ReturnType<typeof ToolGroupManager.createToolGroup>;
    mode: DicomMode;
    mpr?: ReturnType<typeof createMprTools>;
    stack?: DicomStackToolSession;
    reconstruction?: ReturnType<typeof createMprReconstruction>;
    calibrated: boolean;
    referenceEnabled: boolean;
    referenceStyle: ReferenceStyle;
    active: (tool: DicomTool) => void;
  }
) => {
  const { group, mode, mpr, reconstruction, calibrated, referenceEnabled, referenceStyle } =
    context;
  if (!group || !availableIn(tool, mode)) return;
  if (
    mode === 'mpr' &&
    ['probe', 'roi'].includes(tool) &&
    (!calibrated || !reconstruction?.state().quantitative)
  )
    return;
  context.active(tool);
  if (mode === 'mpr' && mpr) {
    mpr.cancel();
    group.setToolPassive(DicomReferencePointTool.toolName);
    [LengthTool, AngleTool, ProbeTool, EllipticalROITool].forEach(item =>
      group?.setToolPassive(item.toolName)
    );
    mpr?.reference(referenceEnabled, referenceStyle);
  }
  if (mode === 'original' && context.stack) {
    context.stack.cancel();
    // Passive keeps every drawing visible and editable while another tool is active.
    dicomStackTools.forEach(item => group.setToolPassive(item.toolName));
  }
  tools
    .filter(candidate => candidate !== StackScrollTool)
    .forEach(candidate => group?.setToolPassive(candidate.toolName));
  group.setToolActive(
    mode === 'original' && dicomMeasureTools.includes(tool)
      ? dicomStackToolName(tool)!
      : tool === 'reference' && reconstruction?.state().rotate
        ? CrosshairsTool.toolName
        : toolNames[tool]!,
    {
      bindings: [
        { mouseButton: ToolEnums.MouseBindings.Primary },
        ...(mode === '3d' && tool === 'zoom'
          ? [{ mouseButton: ToolEnums.MouseBindings.Wheel }]
          : []),
      ],
    }
  );
  if (mode === '3d' && tool !== 'zoom')
    group.setToolActive(ZoomTool.toolName, {
      bindings: [{ mouseButton: ToolEnums.MouseBindings.Wheel }],
    });
};
