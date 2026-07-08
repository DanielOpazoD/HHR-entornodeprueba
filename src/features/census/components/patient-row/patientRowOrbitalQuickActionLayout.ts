/**
 * patientRowOrbitalQuickActionLayout.ts
 *
 * Spatial layout constants for the orbital quick-action launcher that floats
 * beside each patient row in the census table.
 *
 * The launcher is a fixed-position portal with two visual parts:
 *   1. A small circular **trigger button** the user hovers/clicks to open.
 *   2. A vertical **action stack** that fans out below the trigger.
 *
 * Every pixel value here is consumed by `PatientRowOrbitalQuickActionsPortal`
 * and `usePatientRowOrbitalLauncherRuntime` to size, position, and clamp
 * the portal within the viewport.
 */

/** Invisible hit-area around the trigger button (px). Larger than the visual circle to ease targeting. */
export const TRIGGER_HITBOX_SIZE = 48;

/** Rendered diameter of the trigger circle (px). */
export const TRIGGER_VISUAL_SIZE = 28;

/** Diameter of each action-item icon circle (px). */
export const ACTION_ICON_SIZE = 36;

/** Total width of a single action row including icon + label (px). */
export const ACTION_ROW_WIDTH = 130;

/** Minimum height of a single action row (px). */
export const ACTION_ROW_HEIGHT = 44;

/** Vertical gap between consecutive action rows (px). */
export const ACTION_STACK_GAP = 2;

/** Width and height of the wrapper when the launcher is closed (px). Used for viewport clamping. */
export const CLOSED_WRAPPER_SIZE = 72;

/** Width of the wrapper when the launcher is open (px). Wider to contain the action stack. */
export const OPEN_WRAPPER_WIDTH = 158;

/** Horizontal offset of the trigger center from the left edge of the wrapper (px). */
export const TRIGGER_CENTER_OFFSET = 80;

/** Vertical position of the trigger center when the launcher is open (px from wrapper top). */
export const TRIGGER_CENTER_Y_OPEN = 36;

/** Vertical offset where the action stack begins, below the trigger (px from wrapper top). */
export const ACTION_STACK_TOP = 68;

/** Small horizontal nudge that keeps action labels away from the census table content. */
export const ACTION_STACK_HORIZONTAL_SHIFT = 84;

/** Minimum visible distance between the open action menu and the viewport edge. */
export const ACTION_STACK_VIEWPORT_GUTTER = 8;

interface ResolveActionStackHorizontalShiftParams {
  actionRowWidth: number;
  preferredShift: number;
  viewportGutter?: number;
  wrapperLeft: number;
  wrapperWidth: number;
}

export const resolveActionStackHorizontalShift = ({
  actionRowWidth,
  preferredShift,
  viewportGutter = ACTION_STACK_VIEWPORT_GUTTER,
  wrapperLeft,
  wrapperWidth,
}: ResolveActionStackHorizontalShiftParams): number => {
  const centeredStackLeft = wrapperLeft + wrapperWidth / 2 - actionRowWidth / 2;
  const maximumSafeShift = Math.max(0, centeredStackLeft - viewportGutter);

  return Math.min(preferredShift, maximumSafeShift);
};

/**
 * Returns Tailwind class names that style the trigger button based on the
 * current launcher phase.
 *
 * - **idle**: nearly invisible -- transparent ring, no shadow.
 * - **armed**: subtle white background with a light ring (hover preview).
 * - **open**: medical blue tint with a prominent ring and shadow (active state).
 * - **closing**: faded version of the armed state to signal dismissal.
 */
export const resolveTriggerButtonStateClassName = (
  phase: 'idle' | 'armed' | 'open' | 'closing'
): string => {
  if (phase === 'open') {
    return 'bg-medical-50/95 ring-2 ring-medical-400 shadow-md';
  }

  if (phase === 'armed') {
    return 'bg-white/95 ring-1 ring-slate-200 shadow-sm';
  }

  if (phase === 'closing') {
    return 'bg-white/80 ring-1 ring-slate-200/70 shadow-sm opacity-80';
  }

  return 'bg-white/80 ring-1 ring-transparent shadow-none';
};
