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
 * measures from where it was pressed, on that plane. Two clicks still draw a line. */
export const createDicomLengthGesture = (
  group: ToolTypes.IToolGroup,
  engineId: string,
  viewportIds: string[],
  elements: HTMLDivElement[],
  discarded: (annotationUID: string) => void
) => {
  let latest: { uid: string; viewportId: string } | undefined;
  const pending = () => {
    const tool = group.getToolInstance(LengthTool.toolName) as LengthTool | undefined;
    const draft = tool?.isDrawing && tool.editData?.newAnnotation && tool.editData.annotation;
    const added = latest;
    return tool && draft && added && draft.annotationUID === added.uid
      ? { tool, draft, viewportId: added.viewportId }
      : undefined;
  };
  const onAdded = (event: Event) => {
    const detail = (event as ToolTypes.EventTypes.AnnotationAddedEventType).detail;
    const uid = detail.annotation.annotationUID;
    if (
      uid &&
      detail.renderingEngineId === engineId &&
      viewportIds.includes(detail.viewportId || '') &&
      detail.annotation.metadata?.toolName === LengthTool.toolName
    )
      latest = { uid, viewportId: detail.viewportId! };
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
