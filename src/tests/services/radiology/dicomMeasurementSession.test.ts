import { beforeEach, expect, it, vi } from 'vitest';
const cs = vi.hoisted(() => {
  const events = new EventTarget();
  const state = new Map<string, Record<string, unknown>>();
  const emit = (name: string, detail: unknown) =>
    events.dispatchEvent(new CustomEvent(name, { detail }));
  return {
    events,
    state,
    emit,
    removeAnnotation: vi.fn((uid: string) => {
      const annotation = state.get(uid);
      if (!annotation) return;
      state.delete(uid);
      emit('removed', { annotation });
    }),
    addAnnotation: vi.fn((annotation: { annotationUID: string }) => {
      state.set(annotation.annotationUID, annotation);
    }),
  };
});
vi.mock('@cornerstonejs/core', () => ({ eventTarget: cs.events }));
vi.mock('@cornerstonejs/tools', () => ({
  annotation: {
    state: {
      getAnnotation: (uid: string) => cs.state.get(uid),
      removeAnnotation: cs.removeAnnotation,
      addAnnotation: cs.addAnnotation,
    },
  },
  Enums: {
    Events: {
      ANNOTATION_ADDED: 'added',
      ANNOTATION_COMPLETED: 'completed',
      ANNOTATION_MODIFIED: 'modified',
      ANNOTATION_REMOVED: 'removed',
    },
  },
}));
import { createDicomMeasurementSession } from '@/services/radiology/dicomMeasurementSession';
import { createDicomMeasurementStore } from '@/services/radiology/dicomMeasurementStore';

const drawing = (uid: string, imageId = 'dicomfile:1', toolName = 'DicomStackLength') => ({
  annotationUID: uid,
  metadata: { toolName, referencedImageId: imageId, FrameOfReferenceUID: 'synthetic-frame' },
  data: {
    handles: {
      points: [
        [0, 0, 0],
        [10, 0, 0],
      ],
    },
    cachedStats: { [`imageId:${imageId}`]: { length: 10, unit: 'mm' } },
  },
});
const draw = (uid: string, engine = 'synthetic-engine') => {
  const annotation = drawing(uid);
  cs.state.set(uid, annotation);
  cs.emit('added', { annotation, viewportId: 'synthetic-viewport', renderingEngineId: engine });
  return annotation;
};
const session = (store: ReturnType<typeof createDicomMeasurementStore>, imageId = 'dicomfile:1') =>
  createDicomMeasurementSession({
    store,
    engineId: 'synthetic-engine',
    viewportIds: ['synthetic-viewport'],
    toolNames: ['DicomStackLength'],
    owns: item => item.seriesUid === 'synthetic-series',
    render: vi.fn(),
    describe: item => ({
      id: item.annotationUID!,
      kind: 'length',
      seriesUid: 'synthetic-series',
      seriesNumber: 1,
      modality: 'CT',
      view: 'original',
      slice: 4,
      instanceUid: 'synthetic-instance',
    }),
    prepare: (_, copy) => {
      copy.metadata!.referencedImageId = imageId;
      return copy;
    },
  });

beforeEach(() => {
  cs.state.clear();
  vi.clearAllMocks();
});

it('stores a completed drawing and keeps it when its view closes', () => {
  const store = createDicomMeasurementStore();
  const first = session(store);
  draw('drawn');
  expect(store.list()).toHaveLength(0);
  cs.emit('completed', { annotation: cs.state.get('drawn') });
  expect(store.get('drawn')).toMatchObject({
    slice: 4,
    points: [
      [0, 0, 0],
      [10, 0, 0],
    ],
  });
  // The stored copy is detached and carries no statistics of the old image.
  expect(store.get('drawn')!.annotation).not.toBe(cs.state.get('drawn'));
  expect((store.get('drawn')!.annotation as ReturnType<typeof drawing>).data.cachedStats).toEqual(
    {}
  );
  first.dispose();
  expect(cs.state.size).toBe(0);
  expect(store.list().map(item => item.id)).toEqual(['drawn']);
});

it('draws a stored measurement again on the reopened images, once', () => {
  const store = createDicomMeasurementStore();
  const first = session(store);
  draw('drawn');
  cs.emit('completed', { annotation: cs.state.get('drawn') });
  first.dispose();
  const second = session(store, 'dicomfile:2');
  second.restore();
  second.restore();
  expect(cs.addAnnotation).toHaveBeenCalledTimes(1);
  expect(cs.state.get('drawn')).toMatchObject({
    annotationUID: 'drawn',
    isVisible: true,
    metadata: { referencedImageId: 'dicomfile:2' },
  });
  // Deleting it from the list removes the drawing too.
  store.remove('drawn');
  expect(cs.state.has('drawn')).toBe(false);
  second.dispose();
});

it('deletes the stored measurement when its drawing is removed, never a draft', () => {
  const store = createDicomMeasurementStore();
  const current = session(store);
  draw('pending');
  draw('drawn');
  cs.emit('completed', { annotation: cs.state.get('drawn') });
  expect(current.drafts()).toEqual(['pending']);
  cs.removeAnnotation('drawn');
  expect(store.list()).toHaveLength(0);
  // Another viewer's drawing is not this session's.
  draw('foreign', 'other-engine');
  cs.emit('completed', { annotation: cs.state.get('foreign') });
  expect(store.list()).toHaveLength(0);
  current.dispose();
  expect(cs.state.has('pending')).toBe(false);
  expect(cs.state.has('foreign')).toBe(true);
});
