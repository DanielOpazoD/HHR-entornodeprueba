import { dicomToolNames as toolNames } from './dicomToolNames';
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
export const activateDicomTool = (
  tool: DicomTool,
  context: {
    group: ReturnType<typeof ToolGroupManager.createToolGroup>;
    mode: DicomMode;
    mpr?: ReturnType<typeof createMprTools>;
    reconstruction?: ReturnType<typeof createMprReconstruction>;
    calibrated: boolean;
    referenceEnabled: boolean;
    referenceStyle: ReferenceStyle;
    active: (tool: DicomTool) => void;
  }
) => {
  const { group, mode, mpr, reconstruction, calibrated, referenceEnabled, referenceStyle } =
    context;
  if (!group || (mode !== 'mpr' && ['reference', 'length', 'angle', 'probe', 'roi'].includes(tool)))
    return;
  if (['probe', 'roi'].includes(tool) && (!calibrated || !reconstruction?.state().quantitative))
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
  tools
    .filter(candidate => candidate !== StackScrollTool)
    .forEach(candidate => group?.setToolPassive(candidate.toolName));
  group.setToolActive(
    tool === 'reference' && reconstruction?.state().rotate
      ? CrosshairsTool.toolName
      : toolNames[tool],
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
