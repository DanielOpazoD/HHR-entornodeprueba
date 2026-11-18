import { eventTarget, getEnabledElementByIds, type Types } from '@cornerstonejs/core';
import {
  annotation,
  Enums,
  LengthTool,
  utilities,
  type Types as ToolTypes,
} from '@cornerstonejs/tools';

// Cornerstone's own click-versus-drag threshold (DOUBLE_CLICK_DRAG_TOLERANCE, canvas px).
const DRAG_TOLERANCE_PX = 3;

/** Cornerstone 4.22's LengthTool also draws with two clicks: a click leaves a line whose far end
 * follows the pointer until the next release. A later drag then only moved that end, so the
 * distance ran from the earlier click, and a drag on another plane was ignored. A drag now always
 * measures from where it was pressed, on that plane. Two clicks still draw a line. Original and
 * Comparar use their own Length tool name and one tool group per panel. */
export const createDicomLengthGesture = (
  groups: ToolTypes.IToolGroup | ((viewportId: string) => ToolTypes.IToolGroup | undefined),
  engineId: string,
  viewportIds: string[],
  elements: HTMLDivElement[],
  discarded: (annotationUID: string) => void,
  toolName = LengthTool.toolName
) => {
  const groupFor = typeof groups === 'function' ? groups : () => groups;
  // Newest last. Lines redrawn from the measurement list also arrive here; keeping a few
  // lets the pending line be found even if one of those arrived after it.
  const added: Array<{ uid: string; viewportId: string }> = [];
  const pending = () => {
    for (const line of [...added].reverse()) {
      const tool = groupFor(line.viewportId)?.getToolInstance(toolName) as LengthTool | undefined;
      const draft = tool?.isDrawing && tool.editData?.newAnnotation && tool.editData.annotation;
      if (tool && draft && draft.annotationUID === line.uid)
        return { tool, draft, viewportId: line.viewportId };
    }
    return undefined;
  };
  const onAdded = (event: Event) => {
    const detail = (event as ToolTypes.EventTypes.AnnotationAddedEventType).detail;
    const uid = detail.annotation.annotationUID;
    if (
      uid &&
      detail.renderingEngineId === engineId &&
      viewportIds.includes(detail.viewportId || '') &&
      detail.annotation.metadata?.toolName === toolName
    ) {
      added.push({ uid, viewportId: detail.viewportId! });
      if (added.length > 16) added.shift();
    }
  };
  // Capture runs before Cornerstone's dispatcher, which ignores presses while a line is pending.
  const onPress = (event: Event) => {
    const line = pending();
    const { viewportId } = (event as ToolTypes.EventTypes.MouseDownEventType).detail;
    if (!line || line.viewportId === viewportId) return;
    const element = getEnabledElementByIds(line.viewportId, engineId)?.viewport.element;
    if (element) line.tool.cancel(element);
    annotation.state.removeAnnotation(line.draft.annotationUID!);
    discarded(line.draft.annotationUID!);
    utilities.triggerAnnotationRenderForViewportIds([line.viewportId]);
  };
  const onDrag = (event: Event) => {
    const line = pending();
    const { viewportId, startPoints, currentPoints } = (
      event as ToolTypes.EventTypes.MouseDragEventType
    ).detail;
    const points = line?.viewportId === viewportId ? line.draft.data.handles?.points : undefined;
    if (!line || !points) return;
    const moved =
      Math.abs(currentPoints.canvas[0] - startPoints.canvas[0]) +
      Math.abs(currentPoints.canvas[1] - startPoints.canvas[1]);
    if (moved <= DRAG_TOLERANCE_PX) return;
    points[0] = [...startPoints.world] as Types.Point3;
    line.draft.invalidated = true;
  };
  eventTarget.addEventListener(Enums.Events.ANNOTATION_ADDED, onAdded);
  elements.forEach(element => {
    element.addEventListener(Enums.Events.MOUSE_DOWN, onPress, true);
    element.addEventListener(Enums.Events.MOUSE_DRAG, onDrag, true);
  });
  return {
    dispose: () => {
      eventTarget.removeEventListener(Enums.Events.ANNOTATION_ADDED, onAdded);
      elements.forEach(element => {
        element.removeEventListener(Enums.Events.MOUSE_DOWN, onPress, true);
        element.removeEventListener(Enums.Events.MOUSE_DRAG, onDrag, true);
      });
    },
  };
};
