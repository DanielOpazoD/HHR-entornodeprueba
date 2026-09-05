/**
 * Pure position resolver for the UPC checklist popover.
 * Testable without React or DOM — just arithmetic on rects.
 */

export const UPC_CHECKLIST_PANEL_WIDTH = 520;
const ESTIMATED_PANEL_HEIGHT = 560;
const VIEWPORT_PADDING = 8;

export interface UpcPopoverPositionInput {
  buttonRect: DOMRect;
  viewportWidth: number;
  viewportHeight: number;
  panelHeight?: number;
  /** Bottom of the visible sticky navigation/date bars, in viewport coordinates. */
  toolbarBottom?: number;
}

export interface UpcPopoverPosition {
  top: number;
  left: number;
}

export const resolveUpcChecklistPopoverPosition = ({
  buttonRect,
  viewportWidth,
  viewportHeight,
  panelHeight = ESTIMATED_PANEL_HEIGHT,
  toolbarBottom = 0,
}: UpcPopoverPositionInput): UpcPopoverPosition => {
  const minTop = Math.max(VIEWPORT_PADDING, toolbarBottom + VIEWPORT_PADDING);
  const height = Math.min(panelHeight, Math.max(0, viewportHeight - minTop - VIEWPORT_PADDING));
  const preferredTop =
    buttonRect.bottom + 4 + height <= viewportHeight - VIEWPORT_PADDING
      ? buttonRect.bottom + 4
      : buttonRect.top - height - 4;
  const top = Math.max(minTop, Math.min(preferredTop, viewportHeight - height - VIEWPORT_PADDING));
  const left = Math.max(
    VIEWPORT_PADDING,
    Math.min(buttonRect.left, viewportWidth - UPC_CHECKLIST_PANEL_WIDTH - VIEWPORT_PADDING)
  );
  return { top, left };
};
