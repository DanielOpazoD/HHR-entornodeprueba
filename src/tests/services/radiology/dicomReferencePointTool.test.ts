import { describe, expect, it, vi } from 'vitest';
import type { Types as ToolTypes } from '@cornerstonejs/tools';
const { enabled } = vi.hoisted(() => ({ enabled: vi.fn() }));
vi.mock('@cornerstonejs/core', () => ({ getEnabledElement: enabled }));
vi.mock('@cornerstonejs/tools', () => ({
  BaseTool: class {
    configuration: object;
    constructor(props: { configuration: object }) {
      this.configuration = props.configuration;
    }
  },
}));
import { DicomReferencePointTool } from '@/services/radiology/dicomReferencePointTool';

describe('orthogonal reference interaction', () => {
  it('clamps clicks and drags in voxel coordinates before broadcasting a physical point', () => {
    const movePoint = vi.fn();
    const tool = new DicomReferencePointTool({ configuration: { movePoint } });
    enabled.mockReturnValue({
      viewport: {
        getImageData: () => ({
          dimensions: [5, 6, 7],
          imageData: {
            worldToIndex: (world: number[]) => world.map(value => value - 10),
            indexToWorld: (index: number[]) => index.map(value => value + 10),
          },
        }),
      },
    });
    const event = {
      detail: { element: {}, currentPoints: { world: [-100, 20, 100] } },
      preventDefault: vi.fn(),
    };
    tool.preMouseDownCallback(event as unknown as ToolTypes.EventTypes.MouseDownEventType);
    expect(movePoint).toHaveBeenLastCalledWith([10, 15, 16]);
    expect(event.preventDefault).toHaveBeenCalled();
    event.detail.currentPoints.world = [12, 13, 14];
    tool.mouseDragCallback(event as unknown as ToolTypes.EventTypes.MouseDragEventType);
    expect(movePoint).toHaveBeenLastCalledWith([12, 13, 14]);
    event.detail.currentPoints.world = [NaN, 0, 0];
    tool.mouseDragCallback(event as unknown as ToolTypes.EventTypes.MouseDragEventType);
    expect(movePoint).toHaveBeenCalledTimes(2);
  });
});
