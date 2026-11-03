import { createDicomInputBoundary } from './dicomInputBoundary';
import { createDicomLengthGesture } from './dicomLengthGesture';
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
import { createDicomMeasurementSession } from './dicomMeasurementSession';
import type { DicomMeasurementStore, DicomMeasurementView } from './dicomMeasurementStore';
import { readDicomMeasurement, type DicomMeasurementKind } from './dicomMeasurementText';
import { dicomImageInfo, findDicomImage } from './dicomImageRegistry';
import type { DicomSeries } from './dicomTypes';

const measurementKinds = new Map<string, DicomMeasurementKind>([
  [LengthTool.toolName, 'length'],
  [AngleTool.toolName, 'angle'],
  [ProbeTool.toolName, 'probe'],
  [EllipticalROITool.toolName, 'ellipse'],
]);
const planes: DicomMeasurementView[] = ['axial', 'coronal', 'sagittal'];
export interface MprMeasurementContext {
  store: DicomMeasurementStore;
  series: Pick<DicomSeries, 'uid' | 'number' | 'modality'>;
  volumeId: string;
  /** Calibrated HU and a thin orthogonal plane, as for the HU and ROI buttons. */
  quantitative: () => boolean;
  oblique: (plane: number) => boolean;
}

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
  notify: (reference: DicomReference | null) => void,
  measurements: MprMeasurementContext
) => {
  let oblique = false;
  const owned = new Set<string>();
  const elements = viewportIds
    .map(viewportId => getEnabledElementByIds(viewportId, engineId)?.viewport.element)
    .filter((element): element is HTMLDivElement => !!element);
  const inputBoundary = createDicomInputBoundary(elements);
  // After the boundary, so a stale press is rejected before it can discard a pending line.
  const lengthGesture = createDicomLengthGesture(group, engineId, viewportIds, elements, uid =>
    owned.delete(uid)
  );
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
    getReferenceLineDraggableRotatable: () => oblique,
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
  const { store, series } = measurements;
  const owns = (item: { view: string; seriesUid: string }) =>
    item.view !== 'original' && item.seriesUid === series.uid;
  const session = createDicomMeasurementSession({
    store,
    engineId,
    viewportIds,
    toolNames: [...measurementKinds.keys()],
    owns,
    render: () => {
      try {
        getEnabledElementByIds(viewportIds[0], engineId)?.viewport.getRenderingEngine?.()?.render();
      } catch {
        // A closing view may already have released its engine.
      }
    },
    describe: (item, viewportId) => {
      const metadata = (item.metadata ?? {}) as Partial<ToolTypes.AnnotationMetadata> & {
        sliceIndex?: unknown;
      };
      const kind = measurementKinds.get(metadata.toolName ?? '');
      const previous = store.get(item.annotationUID!);
      const plane = viewportIds.indexOf(viewportId ?? '');
      // Density changes only while HU are valid; an oblique or slab view keeps the last value.
      if (!kind || ((kind === 'probe' || kind === 'ellipse') && !measurements.quantitative()))
        return undefined;
      if (plane < 0 && !previous) return undefined;
      const stats = Object.values(
        (item.data.cachedStats ?? {}) as Record<string, Record<string, unknown>>
      ).find(value => Object.values(value).some(Number.isFinite));
      const { sliceIndex } = metadata;
      return {
        id: item.annotationUID!,
        kind,
        seriesUid: series.uid,
        seriesNumber: series.number,
        modality: series.modality,
        view: plane < 0 ? previous!.view : planes[plane],
        oblique: plane < 0 ? previous!.oblique : measurements.oblique(plane),
        slice: typeof sliceIndex === 'number' ? sliceIndex : (previous?.slice ?? 0),
        instanceUid: dicomImageInfo(metadata.referencedImageId)?.instanceUid,
        value: readDicomMeasurement(kind, stats, 'hu'),
      };
    },
    prepare: (item, copy) => {
      const metadata = copy.metadata as ToolTypes.AnnotationMetadata & {
        referencedImageURI?: string;
      };
      if (!metadata) return undefined;
      const imageId = item.instanceUid && findDicomImage(series.uid, item.instanceUid);
      if (imageId) metadata.referencedImageId = imageId;
      else delete metadata.referencedImageId;
      delete metadata.referencedImageURI;
      metadata.volumeId = measurements.volumeId;
      copy.invalidated = true;
      return copy;
    },
  });
  session.restore();
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
    refresh: () => {
      (group.getToolInstance(CrosshairsTool.toolName) as CrosshairsTool).computeToolCenter();
      publish();
    },
    cancel: () => cancel(true),
    quantitative: (enabled: boolean) => {
      for (const uid of owned) {
        const item = annotation.state.getAnnotation(uid);
        if (
          [ProbeTool.toolName, EllipticalROITool.toolName].includes(item?.metadata?.toolName ?? '')
        )
          annotation.visibility.setAnnotationVisibility(uid, enabled);
      }
    },
    oblique: (enabled: boolean) => {
      oblique = enabled;
    },
    reference: (enabled: boolean, style: ReferenceStyle) => {
      group.setToolConfiguration(CrosshairsTool.toolName, {
        minimal: { enabled: !oblique && style === 'point', lineLengthInPx: 12 },
      });
      if (!enabled) {
        group.setToolDisabled(CrosshairsTool.toolName);
        notify(null);
        return;
      }
      group.setToolEnabled(CrosshairsTool.toolName);
      publish();
    },
    owns,
    /** Moves the measured plane along its normal to the drawing; never rotates a plane. */
    focus: (id: string) => {
      const item = store.get(id);
      const live = annotation.state.getAnnotation(id);
      const viewport = item
        ? (getEnabledElementByIds(viewportIds[planes.indexOf(item.view)], engineId)?.viewport as
            | Types.IVolumeViewport
            | undefined)
        : undefined;
      const point = live?.data.handles?.points?.[0];
      const drawn = live?.metadata?.viewPlaneNormal;
      if (!viewport || !point || !drawn) return false;
      const { focalPoint, position, viewPlaneNormal: normal } = viewport.getCamera();
      const dot = (a: Types.Point3, b: Types.Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      if (!focalPoint || !position || !normal || Math.abs(dot(drawn, normal)) < 0.999) return false;
      const shift = dot(
        [0, 1, 2].map(axis => point[axis] - focalPoint[axis]) as Types.Point3,
        normal
      );
      const move = (from: Types.Point3) =>
        from.map((value, axis) => value + shift * normal[axis]) as Types.Point3;
      viewport.setCamera({ focalPoint: move(focalPoint), position: move(position) });
      viewport.render();
      return true;
    },
    // Cancelling completes a pending line first, so undo removes it as the newest measurement.
    undo: () => {
      cancel();
      store.undo(owns);
    },
    clear: () => {
      cancel();
      store.removeWhere(owns);
    },
    dispose: () => {
      cancel(true);
      // Measurements leave the screen but stay in the viewer's store for a later return.
      session.dispose();
      inputBoundary.dispose();
      lengthGesture.dispose();
      group.setToolDisabled(CrosshairsTool.toolName);
      eventTarget.removeEventListener(Enums.Events.ANNOTATION_ADDED, onAdded);
      eventTarget.removeEventListener(Enums.Events.CROSSHAIR_TOOL_CENTER_CHANGED, onCenter);
      for (const uid of owned) annotation.state.removeAnnotation(uid);
      owned.clear();
      notify(null);
    },
  };
};
