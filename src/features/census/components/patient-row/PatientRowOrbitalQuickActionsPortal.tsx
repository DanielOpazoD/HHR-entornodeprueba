/**
 * PatientRowOrbitalQuickActionsPortal.tsx
 *
 * Renders the orbital quick-action launcher into a React portal attached to
 * `document.body`. The portal uses a layered pointer-events architecture so
 * the floating UI never interferes with normal table interactions:
 *
 * **Pointer-events strategy:**
 *   - Outer wrapper div (`fixed z-[39]`) -- `pointer-events-none`.
 *     Covers the launcher's bounding box but is transparent to the mouse,
 *     so clicks pass through to the table underneath.
 *   - Inner relative div -- also `pointer-events-none`. Pure layout shell.
 *   - Action container (`motion.div`) -- `pointer-events-auto`.
 *     Only this element (and its children) intercepts clicks when the
 *     action stack is open.
 *   - Trigger button -- `pointer-events-auto` when `showTrigger` is true,
 *     `pointer-events-none` when hidden, so it does not block row hover.
 *
 * **Z-index layering:**
 *   - `z-[38]` -- Transparent backdrop overlay (click-to-close), below sticky app bars.
 *   - `z-[39]` -- Launcher wrapper (pointer-events-none shell), above table row actions.
 *   - `z-10`   -- Action stack (above the wrapper content so items are clickable).
 *   - `z-10`   -- Trigger button (within the wrapper's stacking context).
 */

import React from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import type { PatientRowOrbitalQuickActionItem } from '@/features/census/controllers/patientRowOrbitalQuickActionsController';
import {
  PATIENT_ROW_ORBITAL_ICON_SRC,
  PATIENT_ROW_ORBITAL_TRIGGER_ICON_SRC,
} from '@/features/census/components/patient-row/patientRowOrbitalQuickActionAssets';
import {
  ACTION_ICON_SIZE,
  ACTION_ROW_HEIGHT,
  ACTION_ROW_WIDTH,
  ACTION_STACK_GAP,
  ACTION_STACK_HORIZONTAL_SHIFT,
  ACTION_STACK_TOP,
  TRIGGER_HITBOX_SIZE,
  TRIGGER_VISUAL_SIZE,
  resolveActionStackHorizontalShift,
  resolveTriggerButtonStateClassName,
} from '@/features/census/components/patient-row/patientRowOrbitalQuickActionLayout';

interface LauncherPosition {
  left: number;
  top: number;
}

interface PatientRowOrbitalQuickActionsPortalProps {
  actionButtonRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
  activeActionIndex: number;
  close: () => void;
  handleActionKeyDown: (index: number, event: React.KeyboardEvent<HTMLButtonElement>) => void;
  handleItemClick: (itemId: PatientRowOrbitalQuickActionItem['id']) => void;
  handleLauncherMouseEnter: () => void;
  handleLauncherMouseLeave: () => void;
  handleTriggerKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  isOpen: boolean;
  launcherWrapperHeight: number;
  launcherWrapperWidth: number;
  menuRef: React.RefObject<HTMLDivElement | null>;
  orbitalItems: PatientRowOrbitalQuickActionItem[];
  phase: Parameters<typeof resolveTriggerButtonStateClassName>[0];
  position: LauncherPosition | null;
  showTrigger: boolean;
  toggle: () => void;
  triggerCenterX: number;
  triggerCenterY: number;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

export const PatientRowOrbitalQuickActionsPortal: React.FC<
  PatientRowOrbitalQuickActionsPortalProps
> = ({
  actionButtonRefs,
  activeActionIndex,
  close,
  handleActionKeyDown,
  handleItemClick,
  handleLauncherMouseEnter,
  handleLauncherMouseLeave,
  handleTriggerKeyDown,
  isOpen,
  launcherWrapperHeight,
  launcherWrapperWidth,
  menuRef,
  orbitalItems,
  phase,
  position,
  showTrigger,
  toggle,
  triggerCenterX,
  triggerCenterY,
  triggerRef,
}) => {
  if (!position || typeof document === 'undefined') {
    return null;
  }

  const actionStackHorizontalShift = resolveActionStackHorizontalShift({
    actionRowWidth: ACTION_ROW_WIDTH,
    preferredShift: ACTION_STACK_HORIZONTAL_SHIFT,
    wrapperLeft: position.left,
    wrapperWidth: launcherWrapperWidth,
  });

  const stopPortalEvent = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    stopPortalEvent(event);
    close();
  };

  const handleActionButtonClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    itemId: PatientRowOrbitalQuickActionItem['id']
  ) => {
    stopPortalEvent(event);
    handleItemClick(itemId);
  };

  const handleTriggerClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    stopPortalEvent(event);
    toggle();
  };

  return createPortal(
    <>
      {/* Backdrop: transparent click-catcher that closes the action stack */}
      {isOpen ? (
        <div className="fixed inset-0 z-[38]" aria-hidden="true" onClick={handleBackdropClick} />
      ) : null}

      {/* Launcher wrapper: pointer-events-none shell positioned over the row */}
      <div
        ref={menuRef}
        className="pointer-events-none fixed z-[39] print:hidden"
        style={{
          left: `${position.left}px`,
          top: `${position.top}px`,
          width: `${launcherWrapperWidth}px`,
          height: `${launcherWrapperHeight}px`,
        }}
      >
        <div className="pointer-events-none relative h-full w-full overflow-visible">
          {/* Action stack: pointer-events-auto so items receive clicks */}
          {isOpen ? (
            <div
              className="pointer-events-auto absolute left-1/2 top-0 z-10 flex -translate-x-1/2 flex-col"
              style={{
                top: `${ACTION_STACK_TOP}px`,
                width: `${ACTION_ROW_WIDTH}px`,
                gap: `${ACTION_STACK_GAP}px`,
                marginLeft: `-${actionStackHorizontalShift}px`,
                padding: '2px 0',
              }}
              onMouseEnter={handleLauncherMouseEnter}
              onMouseLeave={handleLauncherMouseLeave}
              data-state="open"
            >
              {orbitalItems.map((item, index) => (
                <div key={item.id}>
                  <button
                    type="button"
                    onClick={event => handleActionButtonClick(event, item.id)}
                    onKeyDown={event => handleActionKeyDown(index, event)}
                    aria-label={item.tooltip}
                    title={item.tooltip}
                    tabIndex={index === activeActionIndex ? 0 : -1}
                    ref={node => {
                      actionButtonRefs.current[index] = node;
                    }}
                    className={clsx(
                      'flex w-full cursor-pointer items-center gap-2.5 rounded-2xl px-2.5 transition-colors duration-100',
                      'bg-white shadow-sm ring-1 ring-slate-100 hover:bg-white hover:shadow-md',
                      'focus-visible:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300',
                      'active:scale-[0.97]'
                    )}
                    style={{ minHeight: `${ACTION_ROW_HEIGHT}px` }}
                  >
                    <span
                      className={clsx(
                        'relative flex shrink-0 items-center justify-center rounded-full border-2 border-white shadow-md',
                        item.buttonClassName
                      )}
                      style={{
                        width: `${ACTION_ICON_SIZE}px`,
                        height: `${ACTION_ICON_SIZE}px`,
                      }}
                    >
                      <img
                        src={PATIENT_ROW_ORBITAL_ICON_SRC[item.iconAsset]}
                        alt=""
                        aria-hidden="true"
                        draggable={false}
                        className="h-7 w-7 object-contain"
                      />
                      {item.badge != null && item.badge > 0 && (
                        <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-medical-600 px-1 text-[9px] font-bold text-white shadow-sm">
                          {item.badge}
                        </span>
                      )}
                    </span>
                    <span className="flex-1 text-[10px] font-medium leading-tight text-slate-700/90">
                      {item.label}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {/* Trigger button: pointer-events-auto when visible, none when hidden */}
          <button
            type="button"
            onClick={handleTriggerClick}
            onKeyDown={handleTriggerKeyDown}
            onMouseEnter={handleLauncherMouseEnter}
            onMouseLeave={handleLauncherMouseLeave}
            aria-label="Acciones clínicas rápidas"
            aria-expanded={isOpen}
            ref={triggerRef}
            className={clsx(
              'absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center transition-[opacity,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 active:scale-95',
              showTrigger
                ? 'pointer-events-auto opacity-100'
                : 'pointer-events-none opacity-0 shadow-none',
              'bg-transparent border-transparent shadow-none'
            )}
            style={{
              left: `${triggerCenterX}px`,
              top: `${triggerCenterY}px`,
              width: `${TRIGGER_HITBOX_SIZE}px`,
              height: `${TRIGGER_HITBOX_SIZE}px`,
            }}
          >
            <span
              // Visual-only chrome: the parent <button> handles all pointer
              // interaction. Without `pointer-events-none` here, firefox lets
              // this span capture clicks that should reach the patient row
              // beneath (chromium delegates to the button parent silently).
              // See issue #15.
              className={clsx(
                'pointer-events-none flex items-center justify-center overflow-visible rounded-full transition-[background-color,box-shadow,opacity,transform] duration-150',
                resolveTriggerButtonStateClassName(phase)
              )}
              style={{
                width: `${TRIGGER_VISUAL_SIZE}px`,
                height: `${TRIGGER_VISUAL_SIZE}px`,
                transform: `rotate(${isOpen ? 20 : 0}deg) scale(${isOpen ? 1.04 : 1})`,
              }}
            >
              <img
                src={PATIENT_ROW_ORBITAL_TRIGGER_ICON_SRC}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="pointer-events-none object-contain opacity-95"
                style={{
                  width: `${TRIGGER_VISUAL_SIZE}px`,
                  height: `${TRIGGER_VISUAL_SIZE}px`,
                }}
              />
            </span>
          </button>
        </div>
      </div>
    </>,
    document.body
  );
};
