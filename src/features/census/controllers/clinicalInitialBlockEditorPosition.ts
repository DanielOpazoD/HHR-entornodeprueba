import type {
  OverlayAnchorRect,
  VerticalPlacementPosition,
} from '@/shared/ui/anchoredOverlayTypes';

export type ClinicalInitialBlockEditorPosition = VerticalPlacementPosition;

interface ResolveClinicalInitialBlockEditorPositionParams {
  anchorRect: OverlayAnchorRect;
  viewportWidth: number;
  viewportHeight: number;
  panelWidth?: number;
  panelHeight?: number;
  viewportPadding?: number;
  offset?: number;
}

export const resolveClinicalInitialBlockEditorPosition = ({
  anchorRect,
  viewportWidth,
  viewportHeight,
  panelWidth = 384,
  panelHeight = 248,
  viewportPadding = 8,
  offset = 4,
}: ResolveClinicalInitialBlockEditorPositionParams): ClinicalInitialBlockEditorPosition => {
  const availableHeight = Math.max(0, viewportHeight - viewportPadding * 2);
  const boundedPanelHeight = Math.min(panelHeight, availableHeight);
  const availableWidth = Math.max(0, viewportWidth - viewportPadding * 2);
  const boundedPanelWidth = Math.min(panelWidth, availableWidth);
  const anchorRight = anchorRect.right ?? anchorRect.left;
  const spaceBelow = viewportHeight - viewportPadding - anchorRect.bottom - offset;
  const spaceAbove = anchorRect.top - viewportPadding - offset;
  const placement = spaceBelow >= boundedPanelHeight || spaceBelow >= spaceAbove ? 'bottom' : 'top';
  const preferredTop =
    placement === 'bottom'
      ? anchorRect.bottom + offset
      : anchorRect.top - boundedPanelHeight - offset;

  return {
    top: Math.max(
      viewportPadding,
      Math.min(preferredTop, viewportHeight - boundedPanelHeight - viewportPadding)
    ),
    left: Math.max(
      viewportPadding,
      Math.min(anchorRight - boundedPanelWidth, viewportWidth - boundedPanelWidth - viewportPadding)
    ),
    placement,
  };
};
