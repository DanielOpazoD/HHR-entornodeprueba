import { createDicomInputBoundary } from './dicomInputBoundary';
import { eventTarget, getEnabledElementByIds, type Types } from '@cornerstonejs/core';
import {
  cancelActiveManipulations,
  CrosshairsTool,
  LengthTool,
  AngleTool,
  ProbeTool,
  EllipticalROITool,
  annotation,
  Enums,
  type Types as ToolTypes,
} from '@cornerstonejs/tools';

import { huProbeText, huRoiText } from './dicomQuantitative';
import { DicomReferencePointTool } from './dicomReferencePointTool';

export const mprTools = [
  CrosshairsTool,
  LengthTool,
  AngleTool,
  DicomReferencePointTool,
  ProbeTool,
  EllipticalROITool,
];
export type ReferenceStyle = 'lines' | 'point';
export interface DicomReference {
  point: Types.Point3;
}

/** Viewer-scoped listeners and annotations; nothing is persisted or sent to telemetry. */
export const createMprTools = (
  group: ToolTypes.IToolGroup,
  engineId: string,
  viewportIds: string[],
  notify: (reference: DicomReference | null) => void
) => {
  const owned = new Set<string>();
  const elements = viewportIds
    .map(viewportId => getEnabledElementByIds(viewportId, engineId)?.viewport.element)
    .filter((element): element is HTMLDivElement => !!element);
  const inputBoundary = createDicomInputBoundary(elements);
  const onAdded = (event: Event) => {
    const detail = (event as ToolTypes.EventTypes.AnnotationAddedEventType).detail;
    if (
      detail.renderingEngineId === engineId &&
      viewportIds.includes(detail.viewportId || '') &&
      detail.annotation.annotationUID
    )
      owned.add(detail.annotation.annotationUID);
  };
  const onCenter = (event: Event) => {
    const detail = (event as CustomEvent<{ toolGroupId: string; toolCenter: Types.Point3 }>).detail;
    if (detail.toolGroupId === group.id && detail.toolCenter?.every(Number.isFinite))
      notify({ point: [...detail.toolCenter] });
  };
  eventTarget.addEventListener(Enums.Events.ANNOTATION_ADDED, onAdded);
  eventTarget.addEventListener(Enums.Events.CROSSHAIR_TOOL_CENTER_CHANGED, onCenter);
  group.addTool(CrosshairsTool.toolName, {
    getReferenceLineColor: (id: string) =>
      ['#fb7185', '#4ade80', '#60a5fa'][viewportIds.indexOf(id)] || '#fff',
    getReferenceLineDraggableRotatable: () => false,
    getReferenceLineSlabThicknessControlsOn: () => false,
    centerPoint: { enabled: true, color: '#facc15', size: 3 },
    referenceLinesCenterGapRadius: 6,
  });
  group.addTool(DicomReferencePointTool.toolName, {
    movePoint: (point: Types.Point3) => {
      (group.getToolInstance(CrosshairsTool.toolName) as CrosshairsTool).setToolCenter(point);
    },
  });
  group.addTool(LengthTool.toolName);
  group.addTool(AngleTool.toolName);
  group.addTool(ProbeTool.toolName, { getTextLines: huProbeText });
  group.addTool(EllipticalROITool.toolName, {
    getTextLines: huRoiText,
    storePointData: false,
    preventHandleOutsideImage: true,
  });
  const publish = () => {
    const tool = group.getToolInstance(CrosshairsTool.toolName) as CrosshairsTool;
    if (tool.toolCenter.every(Number.isFinite)) notify({ point: [...tool.toolCenter] });
  };
  const cancel = (discardDrafts = false) => {
    inputBoundary.invalidate();
    const drafts = discardDrafts
      ? [LengthTool, AngleTool, EllipticalROITool].flatMap(tool => {
          const instance = group.getToolInstance(tool.toolName) as
            | LengthTool
            | AngleTool
            | EllipticalROITool;
          const draft = instance.editData;
          return instance.isDrawing && draft?.newAnnotation && draft.annotation.annotationUID
            ? [draft.annotation.annotationUID]
            : [];
        })
      : [];
    elements.forEach(element => cancelActiveManipulations(element));
    for (const uid of drafts)
      if (owned.has(uid)) {
        annotation.state.removeAnnotation(uid);
        owned.delete(uid);
      }
  };
  return {
    cancel: () => cancel(true),
    reference: (enabled: boolean, style: ReferenceStyle) => {
      group.setToolConfiguration(CrosshairsTool.toolName, {
        minimal: { enabled: style === 'point', lineLengthInPx: 12 },
      });
      if (!enabled) {
        group.setToolDisabled(CrosshairsTool.toolName);
        notify(null);
        return;
      }
      group.setToolEnabled(CrosshairsTool.toolName);
      publish();
    },
    undo: () => {
      cancel();
      for (const uid of [...owned].reverse()) {
        const item = annotation.state.getAnnotation(uid);
        if (item && item.metadata?.toolName !== CrosshairsTool.toolName) {
          annotation.state.removeAnnotation(uid);
          owned.delete(uid);
          break;
        }
      }
    },
    clear: () => {
      cancel();
      for (const uid of owned) {
        const item = annotation.state.getAnnotation(uid);
        if (item?.metadata?.toolName !== CrosshairsTool.toolName) {
          annotation.state.removeAnnotation(uid);
          owned.delete(uid);
        }
      }
    },
    dispose: () => {
      cancel();
      inputBoundary.dispose();
      group.setToolDisabled(CrosshairsTool.toolName);
      eventTarget.removeEventListener(Enums.Events.ANNOTATION_ADDED, onAdded);
      eventTarget.removeEventListener(Enums.Events.CROSSHAIR_TOOL_CENTER_CHANGED, onCenter);
      for (const uid of owned) annotation.state.removeAnnotation(uid);
      owned.clear();
      notify(null);
    },
  };
};
