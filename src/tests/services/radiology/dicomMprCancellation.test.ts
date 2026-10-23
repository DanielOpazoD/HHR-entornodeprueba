import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  cancel: vi.fn(),
  enabled: vi.fn(),
  events: new EventTarget(),
}));
vi.mock('@cornerstonejs/core', () => ({
  eventTarget: mocks.events,
  getEnabledElementByIds: mocks.enabled,
}));
vi.mock('@/services/radiology/dicomQuantitative', () => ({
  huProbeText: vi.fn(),
  huRoiText: vi.fn(),
}));
vi.mock('@/services/radiology/dicomReferencePointTool', () => ({
  DicomReferencePointTool: { toolName: 'Reference' },
}));
vi.mock('@cornerstonejs/tools', () => ({
  cancelActiveManipulations: mocks.cancel,
  CrosshairsTool: { toolName: 'Crosshairs' },
  LengthTool: { toolName: 'Length' },
  AngleTool: { toolName: 'Angle' },
  ProbeTool: { toolName: 'Probe' },
  EllipticalROITool: { toolName: 'ROI' },
  annotation: { state: { removeAnnotation: mocks.remove } },
  Enums: {
    Events: {
      ANNOTATION_ADDED: 'added',
      CROSSHAIR_TOOL_CENTER_CHANGED: 'center',
      MOUSE_DOWN: 'down',
      MOUSE_DOWN_ACTIVATE: 'activate',
    },
  },
}));
import { createMprTools } from '@/services/radiology/dicomMprTools';
beforeEach(() => {
  vi.clearAllMocks();
});
it.each([true, false])(
  'cancels manipulation and removes only an owned new draft (new=%s)',
  newAnnotation => {
    const element = document.createElement('div');
    mocks.enabled.mockReturnValue({ viewport: { element } });
    const tool = {
      isDrawing: true,
      editData: { newAnnotation, annotation: { annotationUID: 'synthetic-draft' } },
    };
    const group = {
      id: 'synthetic-group',
      addTool: vi.fn(),
      setToolDisabled: vi.fn(),
      getToolInstance: (name: string) =>
        name === 'Length' ? tool : { isDrawing: false, editData: null },
    } as unknown as Parameters<typeof createMprTools>[0];
    mocks.cancel.mockImplementation(() => {
      tool.isDrawing = false;
    });
    const session = createMprTools(group, 'synthetic-engine', ['synthetic-viewport'], vi.fn());
    mocks.events.dispatchEvent(
      new CustomEvent('added', {
        detail: {
          renderingEngineId: 'synthetic-engine',
          viewportId: 'synthetic-viewport',
          annotation: { annotationUID: 'synthetic-draft' },
        },
      })
    );
    session.cancel();
    expect(mocks.cancel).toHaveBeenCalledWith(element);
    if (newAnnotation) expect(mocks.remove).toHaveBeenCalledWith('synthetic-draft');
    else expect(mocks.remove).not.toHaveBeenCalled();
    session.dispose();
  }
);
it('never removes an annotation owned by a different viewer', () => {
  mocks.enabled.mockReturnValue({ viewport: { element: document.createElement('div') } });
  const group = {
    id: 'own',
    addTool: vi.fn(),
    setToolDisabled: vi.fn(),
    getToolInstance: () => ({
      isDrawing: true,
      editData: { newAnnotation: true, annotation: { annotationUID: 'other-draft' } },
    }),
  } as unknown as Parameters<typeof createMprTools>[0];
  mocks.cancel.mockImplementation(() => undefined);
  const session = createMprTools(group, 'own-engine', ['own-viewport'], vi.fn());
  mocks.events.dispatchEvent(
    new CustomEvent('added', {
      detail: {
        renderingEngineId: 'other-engine',
        viewportId: 'other-viewport',
        annotation: { annotationUID: 'other-draft' },
      },
    })
  );
  session.cancel();
  expect(mocks.remove).not.toHaveBeenCalled();
  session.dispose();
  expect(mocks.remove).not.toHaveBeenCalled();
});
