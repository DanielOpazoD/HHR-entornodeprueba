import { getEnabledElement, type Types } from '@cornerstonejs/core';
import { BaseTool, type Types as ToolTypes } from '@cornerstonejs/tools';

/** Moves a shared physical point without enabling oblique rotation of MPR planes. */
export class DicomReferencePointTool extends BaseTool {
  static toolName = 'DicomReferencePoint';
  constructor(toolProps: ToolTypes.PublicToolProps = {}) {
    super(toolProps, { supportedInteractionTypes: ['Mouse'], configuration: {} });
  }
  preMouseDownCallback = (event: ToolTypes.EventTypes.MouseDownEventType) => {
    this.move(event);
    event.preventDefault();
    return true;
  };
  mouseDragCallback = (event: ToolTypes.EventTypes.MouseDragEventType) => this.move(event);
  private move(
    event: ToolTypes.EventTypes.MouseDownEventType | ToolTypes.EventTypes.MouseDragEventType
  ) {
    const viewport = getEnabledElement(event.detail.element)?.viewport as Types.IVolumeViewport;
    const data = viewport?.getImageData();
    const world = event.detail.currentPoints.world;
    if (!data?.imageData || !world.every(Number.isFinite)) return;
    // Clamp in acquired voxel coordinates (including oblique source volumes), not LPS bounds.
    const index = data.imageData.worldToIndex(world) as Types.Point3;
    const dimensions = data.dimensions;
    if (!index.every(Number.isFinite) || dimensions.some(size => size < 1)) return;
    const bounded = index.map((value, axis) =>
      Math.max(0, Math.min(dimensions[axis] - 1, value))
    ) as Types.Point3;
    const point = data.imageData.indexToWorld(bounded) as Types.Point3;
    (this.configuration.movePoint as (point: Types.Point3) => void)?.(point);
  }
}
