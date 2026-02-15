import type {
  OverlayAnchorRect,
  VerticalPlacementPosition,
} from '@/shared/ui/anchoredOverlayTypes';

export type DeviceMenuPosition = VerticalPlacementPosition;

interface ResolveDeviceMenuPositionParams {
  anchorRect: OverlayAnchorRect;
  viewportWidth: number;
  viewportHeight: number;
  menuWidth?: number;
  menuMaxHeight?: number;
  viewportPadding?: number;
  offset?: number;
}

export const resolveDeviceMenuPosition = ({
  anchorRect,
  viewportWidth,
  viewportHeight,
  menuWidth = 360,
  menuMaxHeight = 400,
  viewportPadding = 12,
  offset = 8,
}: ResolveDeviceMenuPositionParams): DeviceMenuPosition => {
  const left = Math.max(
    viewportPadding,
    Math.min(anchorRect.left, viewportWidth - menuWidth - viewportPadding)
  );

  const spaceBelow = viewportHeight - anchorRect.bottom;
  const shouldShowAbove = spaceBelow < menuMaxHeight && anchorRect.top > spaceBelow;

  return {
    top: shouldShowAbove ? anchorRect.top - offset : anchorRect.bottom + offset,
    left,
    placement: shouldShowAbove ? 'top' : 'bottom',
  };
};
