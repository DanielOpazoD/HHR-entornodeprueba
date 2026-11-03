import { eventTarget } from '@cornerstonejs/core';
import { annotation as annotations, Enums, type Types as ToolTypes } from '@cornerstonejs/tools';
import type { DicomMeasurement, DicomMeasurementStore } from './dicomMeasurementStore';

type Annotation = ToolTypes.Annotation;
type Detail = { annotation?: Annotation; viewportId?: string; renderingEngineId?: string };

export interface DicomMeasurementContext {
  store: DicomMeasurementStore;
  engineId: string;
  viewportIds: string[];
  toolNames: string[];
  /** The record of a completed or edited annotation, or undefined to leave the store as is. */
  describe: (
    annotation: Annotation,
    viewportId: string | undefined
  ) => Omit<DicomMeasurement, 'annotation' | 'points'> | undefined;
  /** Whether a stored measurement belongs to these viewports (series and view). */
  owns: (item: DicomMeasurement) => boolean;
  /** Adapts a detached copy to the current images, or undefined while its image is missing. */
  prepare: (item: DicomMeasurement, copy: Annotation) => Annotation | undefined;
  render: () => void;
}

const detach = (item: Annotation): Annotation => {
  const plain = { ...item, data: { ...item.data, cachedStats: {} } };
  try {
    return structuredClone(plain);
  } catch {
    return JSON.parse(JSON.stringify(plain)) as Annotation;
  }
};

/**
 * Keeps Cornerstone annotations of a set of viewports and the viewer's measurement store in step.
 * Drawing or editing updates the store; deleting from the store removes the drawing; disposing
 * only takes the drawings off the screen, so they come back when the series or view returns.
 */
export const createDicomMeasurementSession = (context: DicomMeasurementContext) => {
  const { store, engineId, viewportIds, toolNames } = context;
  const live = new Map<string, string | undefined>();
  const committed = new Set<string>();
  let disposed = false;
  const commit = (item: Annotation, viewportId: string | undefined) => {
    const uid = item.annotationUID!;
    const record = context.describe(item, viewportId ?? live.get(uid));
    if (!record) return;
    committed.add(uid);
    store.upsert({
      ...record,
      points: (item.data.handles?.points ?? []).map(point => [...point]),
      annotation: detach(item),
    });
  };
  const ours = (detail: Detail) =>
    detail.renderingEngineId === engineId && viewportIds.includes(detail.viewportId ?? '');
  const onAdded = (event: Event) => {
    const detail = (event as CustomEvent<Detail>).detail;
    const item = detail.annotation;
    if (item?.annotationUID && ours(detail) && toolNames.includes(item.metadata?.toolName ?? ''))
      live.set(item.annotationUID, detail.viewportId);
  };
  const onCompleted = (event: Event) => {
    const item = (event as CustomEvent<Detail>).detail.annotation;
    if (item?.annotationUID && live.has(item.annotationUID)) commit(item, undefined);
  };
  const onModified = (event: Event) => {
    const detail = (event as CustomEvent<Detail & { changeType?: string }>).detail;
    const item = detail.annotation;
    // A handle drag fires on every pointer move; the throttled statistics update that follows
    // carries the same handles with their new value.
    if (detail.changeType === 'HandlesUpdated' || detail.changeType === 'Interaction') return;
    if (item?.annotationUID && committed.has(item.annotationUID))
      commit(item, ours(detail) ? detail.viewportId : undefined);
  };
  // Removing a drawing deletes its measurement. Dispose forgets its drawings first, so taking
  // them off screen keeps the measurements.
  const onRemoved = (event: Event) => {
    const uid = (event as CustomEvent<Detail>).detail.annotation?.annotationUID;
    if (!uid || !live.delete(uid)) return;
    if (committed.delete(uid)) store.remove(uid);
  };
  const remove = (uids: string[]) => {
    if (!uids.length) return;
    uids.forEach(uid => annotations.state.removeAnnotation(uid));
    context.render();
  };
  const events: Array<[string, (event: Event) => void]> = [
    [Enums.Events.ANNOTATION_ADDED, onAdded],
    [Enums.Events.ANNOTATION_COMPLETED, onCompleted],
    [Enums.Events.ANNOTATION_MODIFIED, onModified],
    [Enums.Events.ANNOTATION_REMOVED, onRemoved],
  ];
  events.forEach(([name, listener]) => eventTarget.addEventListener(name, listener));
  const unsubscribe = store.subscribe(() => {
    if (!disposed) remove([...committed].filter(uid => !store.get(uid)));
  });
  const restore = () => {
    if (disposed) return;
    let added = false;
    for (const item of store.list()) {
      if (!context.owns(item) || annotations.state.getAnnotation(item.id)) continue;
      const copy = context.prepare(item, detach(item.annotation as Annotation));
      if (!copy) continue;
      Object.assign(copy, { annotationUID: item.id, isVisible: true, highlighted: false });
      live.set(item.id, undefined);
      committed.add(item.id);
      // A string selector groups it by its own frame of reference, as the tool did.
      annotations.state.addAnnotation(copy, copy.metadata?.FrameOfReferenceUID ?? '');
      added = true;
    }
    if (added) context.render();
  };
  return {
    restore,
    /** Live drawings of this session that are not yet in the store (a pending two-click line). */
    drafts: () => [...live.keys()].filter(uid => !committed.has(uid)),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      events.forEach(([name, listener]) => eventTarget.removeEventListener(name, listener));
      unsubscribe();
      const uids = [...live.keys()];
      live.clear();
      committed.clear();
      remove(uids);
    },
  };
};
export type DicomMeasurementSession = ReturnType<typeof createDicomMeasurementSession>;
