import { getRenderingEngine } from '@cornerstonejs/core';
import {
  AngleTool,
  annotation as annotations,
  cancelActiveManipulations,
  CircleROITool,
  CobbAngleTool,
  EllipticalROITool,
  LengthTool,
  ProbeTool,
  RectangleROITool,
  type Types as ToolTypes,
} from '@cornerstonejs/tools';
import { createDicomInputBoundary } from './dicomInputBoundary';
import { createDicomLengthGesture } from './dicomLengthGesture';
import { createDicomMeasurementSession } from './dicomMeasurementSession';
import type { DicomMeasurementStore } from './dicomMeasurementStore';
import { findDicomImage, onDicomImageRegistered } from './dicomImageRegistry';
import {
  describeDicomStackAnnotation,
  dicomStackTextLines,
  dicomStackToolKinds,
  dicomStackToolNames,
  type DicomStackMeasureTool,
} from './dicomStackMeasurement';

// Own tool names keep Original and Comparar drawings apart from MPR's on the same frame.
// The stacks hold one image at a time, so Cornerstone's per-image index (k) is always 0.
export class DicomStackLengthTool extends LengthTool {
  static override toolName = dicomStackToolNames.length;
}
export class DicomStackAngleTool extends AngleTool {
  static override toolName = dicomStackToolNames.angle;
}
export class DicomStackCobbAngleTool extends CobbAngleTool {
  static override toolName = dicomStackToolNames.cobb;
}
export class DicomStackProbeTool extends ProbeTool {
  static override toolName = dicomStackToolNames.probe;
}
export class DicomStackEllipseTool extends EllipticalROITool {
  static override toolName = dicomStackToolNames.roi;
}
export class DicomStackRectangleTool extends RectangleROITool {
  static override toolName = dicomStackToolNames.rectangle;
}
export class DicomStackCircleTool extends CircleROITool {
  static override toolName = dicomStackToolNames.circle;
}
export type { DicomStackMeasureTool };

export const dicomStackTools = [
  DicomStackLengthTool,
  DicomStackAngleTool,
  DicomStackCobbAngleTool,
  DicomStackProbeTool,
  DicomStackEllipseTool,
  DicomStackRectangleTool,
  DicomStackCircleTool,
];
export const dicomStackToolName = (tool: string): string | undefined =>
  dicomStackToolNames[tool as DicomStackMeasureTool];
const toolNames = Object.keys(dicomStackToolKinds);

type Draft = {
  isDrawing?: boolean;
  editData?: { newAnnotation?: boolean; annotation?: { annotationUID?: string } };
};
export interface DicomStackPanel {
  viewportId: string;
  group: ToolTypes.IToolGroup;
  element: HTMLDivElement;
}

/**
 * Distance, angle, Cobb, density and ROIs on single-image stacks (Original and Comparar).
 * Drawings follow the image, not the panel: the same series shows them in every panel.
 */
export const createDicomStackTools = (
  engineId: string,
  panels: DicomStackPanel[],
  store: DicomMeasurementStore,
  seriesUids: string[]
) => {
  const viewportIds = panels.map(panel => panel.viewportId);
  const elements = panels.map(panel => panel.element);
  for (const panel of panels)
    for (const toolName of toolNames) {
      const kind = dicomStackToolKinds[toolName];
      panel.group.addTool(toolName, {
        getTextLines: dicomStackTextLines(kind),
        ...(['ellipse', 'rectangle', 'circle'].includes(kind)
          ? { storePointData: false, preventHandleOutsideImage: true }
          : {}),
      });
      panel.group.setToolPassive(toolName);
    }
  const render = () => {
    try {
      getRenderingEngine(engineId)?.renderViewports(viewportIds);
    } catch {
      // The engine is already gone when a closing view removes its drawings.
    }
  };
  const owns = (item: { view: string; seriesUid: string }) =>
    item.view === 'original' && seriesUids.includes(item.seriesUid);
  const session = createDicomMeasurementSession({
    store,
    engineId,
    viewportIds,
    toolNames,
    owns,
    render,
    describe: item => describeDicomStackAnnotation(item, seriesUids),
    prepare: (item, copy) => {
      const imageId = item.instanceUid && findDicomImage(item.seriesUid, item.instanceUid);
      const metadata = copy.metadata as
        | (ToolTypes.AnnotationMetadata & { referencedImageURI?: string })
        | undefined;
      if (!imageId || !metadata) return undefined;
      metadata.referencedImageId = imageId;
      delete metadata.referencedImageURI;
      copy.invalidated = true;
      return copy;
    },
  });
  const inputBoundary = createDicomInputBoundary(elements);
  const lengthGesture = createDicomLengthGesture(
    viewportId => panels.find(panel => panel.viewportId === viewportId)?.group,
    engineId,
    viewportIds,
    elements,
    () => undefined,
    DicomStackLengthTool.toolName
  );
  // Images of a reopened series arrive progressively; their drawings return as they load.
  const stopWatching = onDicomImageRegistered(info => {
    if (seriesUids.includes(info.seriesUid)) session.restore();
  });
  session.restore();
  /** Ends a gesture and drops a half-drawn line; reports whether there was one. */
  const cancel = () => {
    inputBoundary.invalidate();
    // Collected first: Cornerstone's cancel completes a new drawing instead of dropping it.
    const drafts = new Set(session.drafts());
    for (const panel of panels)
      for (const toolName of toolNames) {
        const instance = panel.group.getToolInstance(toolName) as Draft | undefined;
        const uid = instance?.editData?.annotation?.annotationUID;
        if (instance?.isDrawing && instance.editData?.newAnnotation && uid) drafts.add(uid);
      }
    elements.forEach(element => cancelActiveManipulations(element));
    drafts.forEach(uid => annotations.state.removeAnnotation(uid));
    if (drafts.size) render();
    return drafts.size > 0;
  };
  return {
    owns,
    cancel,
    // A half-drawn line is the newest measurement: undo drops only it.
    undo: () => {
      if (!cancel()) store.undo(owns);
    },
    clear: () => {
      cancel();
      store.removeWhere(owns);
    },
    dispose: () => {
      cancel();
      stopWatching();
      inputBoundary.dispose();
      lengthGesture.dispose();
      session.dispose();
    },
  };
};
export type DicomStackToolSession = ReturnType<typeof createDicomStackTools>;
