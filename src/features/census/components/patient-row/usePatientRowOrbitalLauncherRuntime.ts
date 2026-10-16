import React from 'react';
import { usePatientRowOrbitalLauncherMachine } from '@/features/census/components/patient-row/usePatientRowOrbitalLauncherMachine';
import {
  HOVER_EXIT_GRACE_MS,
  HOVER_FINE_MEDIA_QUERY,
  LAUNCHER_OPEN_EVENT,
  LAUNCHER_OWNER_EVENT,
  dispatchLauncherOpenChange,
  dispatchLauncherOwnerChange,
  resolveRowHoverActionFromGlobalPointer,
  resolveRowHoverActionFromRowPointer,
  resolveLauncherTriggerVisibility,
  resolveVisibilityHiddenLauncherState,
  shouldReleaseLauncherOwnership,
  resolveLauncherPosition,
  resolveRowElement,
  resolveRowId,
  resolveSupportsHoverFine,
  type LauncherActiveChangeDetail,
  type LauncherPosition,
  type UsePatientRowOrbitalLauncherRuntimeParams,
  type UsePatientRowOrbitalLauncherRuntimeResult,
} from '@/features/census/components/patient-row/patientRowOrbitalLauncherRuntimeSupport';

export { HOVER_EXIT_GRACE_MS };

export const usePatientRowOrbitalLauncherRuntime = ({
  hasQuickActions,
  isOpen,
  launcherOffset,
  wrapperWidth,
  wrapperHeight,
  triggerCenterX,
  triggerCenterY,
}: UsePatientRowOrbitalLauncherRuntimeParams): UsePatientRowOrbitalLauncherRuntimeResult => {
  const anchorRef = React.useRef<HTMLSpanElement>(null);
  const [supportsHoverFine, setSupportsHoverFine] = React.useState(resolveSupportsHoverFine);
  const [isRowHovered, setIsRowHovered] = React.useState(false);
  const [isLauncherHovered, setIsLauncherHovered] = React.useState(false);
  const [isHoverGraceActive, setIsHoverGraceActive] = React.useState(false);
  const [position, setPosition] = React.useState<LauncherPosition | null>(null);
  const positionRef = React.useRef<LauncherPosition | null>(null);
  const [rowId, setRowId] = React.useState<string | null>(null);
  const [activeLauncherRowId, setActiveLauncherRowId] = React.useState<string | null>(null);
  const [ownerLauncherRowId, setOwnerLauncherRowId] = React.useState<string | null>(null);
  const ownerLauncherRowIdRef = React.useRef<string | null>(null);
  const hoverExitTimerRef = React.useRef<number | null>(null);

  const isOpenRef = React.useRef(isOpen);
  const isLauncherHoveredRef = React.useRef(isLauncherHovered);
  const isRowHoveredRef = React.useRef(isRowHovered);
  const rowIdRef = React.useRef(rowId);

  React.useEffect(() => {
    isOpenRef.current = isOpen;
    isLauncherHoveredRef.current = isLauncherHovered;
    isRowHoveredRef.current = isRowHovered;
    rowIdRef.current = rowId;
  }, [isLauncherHovered, isOpen, isRowHovered, rowId]);
  React.useEffect(() => {
    ownerLauncherRowIdRef.current = ownerLauncherRowId;
  }, [ownerLauncherRowId]);

  const clearHoverExitTimer = React.useCallback(() => {
    if (hoverExitTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(hoverExitTimerRef.current);
      hoverExitTimerRef.current = null;
    }
  }, []);

  const claimLauncherOwnership = React.useCallback(
    (nextRowId: string | null) => {
      clearHoverExitTimer();
      setIsHoverGraceActive(true);
      if (nextRowId) {
        dispatchLauncherOwnerChange(nextRowId);
      }
    },
    [clearHoverExitTimer]
  );

  const activateHoveredRow = React.useCallback(
    (nextRowId: string | null, syncPosition: () => void) => {
      claimLauncherOwnership(nextRowId);
      setIsRowHovered(true);
      syncPosition();
    },
    [claimLauncherOwnership]
  );

  /**
   * Starts the hover-exit grace period. After `HOVER_EXIT_GRACE_MS` the
   * timer checks whether the pointer truly left (via refs to avoid stale
   * state) and releases ownership if so.
   */
  const armHoverGrace = React.useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    clearHoverExitTimer();
    setIsHoverGraceActive(true);
    hoverExitTimerRef.current = window.setTimeout(() => {
      setIsHoverGraceActive(false);
      // Read current values from refs -- the closure captures the ref
      // objects (stable) not the state values (potentially stale).
      if (
        shouldReleaseLauncherOwnership({
          ownerLauncherRowId: ownerLauncherRowIdRef.current,
          rowId: rowIdRef.current,
          isOpen: isOpenRef.current,
          isLauncherHovered: isLauncherHoveredRef.current,
          isRowHovered: isRowHoveredRef.current,
        })
      ) {
        dispatchLauncherOwnerChange(null);
      }
      hoverExitTimerRef.current = null;
    }, HOVER_EXIT_GRACE_MS);
  }, [clearHoverExitTimer]);

  const deactivateHoveredRow = React.useCallback(() => {
    setIsRowHovered(false);
    armHoverGrace();
  }, [armHoverGrace]);

  const releaseLauncherHover = React.useCallback(() => {
    setIsLauncherHovered(false);
    armHoverGrace();
  }, [armHoverGrace]);

  const resetHoverState = React.useCallback(() => {
    setIsRowHovered(false);
    setIsLauncherHovered(false);
    setIsHoverGraceActive(false);
  }, []);

  // === VISIBILITY & MEDIA QUERY ===

  // --- visibilitychange: flush hover state when the tab goes to background ---
  React.useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        const hiddenState = resolveVisibilityHiddenLauncherState({
          ownerLauncherRowId: ownerLauncherRowIdRef.current,
          rowId: rowIdRef.current,
        });
        clearHoverExitTimer();
        if (hiddenState.shouldResetHoverState) {
          resetHoverState();
        }
        if (hiddenState.shouldClearOwnership) {
          dispatchLauncherOwnerChange(null);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [clearHoverExitTimer, resetHoverState]);

  // --- Media-query listener: track hover+fine capability changes ---
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia(HOVER_FINE_MEDIA_QUERY);
    const sync = (event?: MediaQueryListEvent) => {
      setSupportsHoverFine(event ? event.matches : mediaQuery.matches);
    };

    sync();
    mediaQuery.addEventListener('change', sync);
    return () => {
      mediaQuery.removeEventListener('change', sync);
    };
  }, []);

  // === ROW EVENT LISTENERS ===

  // --- Row event listeners: hover, focus, position syncing ---
  React.useEffect(() => {
    const row = resolveRowElement(anchorRef.current);
    if (!row) {
      return;
    }

    const resolvedRowId = resolveRowId(row);
    setRowId(resolvedRowId);

    const syncPosition = () => {
      const nextPosition = resolveLauncherPosition(
        row,
        launcherOffset,
        wrapperWidth,
        wrapperHeight,
        triggerCenterX,
        triggerCenterY
      );
      if (
        positionRef.current?.left === nextPosition?.left &&
        positionRef.current?.top === nextPosition?.top
      )
        return;
      positionRef.current = nextPosition;
      setPosition(nextPosition);
    };

    /**
     * Instead of simple mouseenter/mouseleave, we use mousemove to
     * restrict the activation zone to the left side of the row (up to
     * and including the RUT column). Moving the pointer right of the
     * RUT cell is treated as leaving the activation zone.
     */
    const activateRowHover = () => {
      if (!isRowHoveredRef.current) {
        activateHoveredRow(resolvedRowId, syncPosition);
      }
    };

    const deactivateRowHover = () => {
      if (isRowHoveredRef.current) {
        deactivateHoveredRow();
      }
    };

    const handleRowMouseMove = (event: MouseEvent) => {
      if (resolveRowHoverActionFromRowPointer(event.clientX, row) === 'activate') {
        activateRowHover();
      } else {
        deactivateRowHover();
      }
    };

    const handleGlobalMouseMove = (event: MouseEvent) => {
      // A table row already handles its own pointer activation. Other rows only
      // need to release hover; probing every row's bounds adds layout work per move.
      const pointerRow =
        event.target instanceof Element
          ? event.target.closest('tr[data-testid="patient-row"]')
          : null;
      if (pointerRow) {
        if (pointerRow !== row) deactivateRowHover();
        return;
      }
      const targetInsideRow = event.target instanceof Node && row.contains(event.target);
      const hoverAction = resolveRowHoverActionFromGlobalPointer({
        pointerX: event.clientX,
        pointerY: event.clientY,
        row,
        targetInsideRow,
      });

      if (hoverAction === 'activate') {
        activateRowHover();
      } else if (hoverAction === 'deactivate') {
        deactivateRowHover();
      }
    };

    const handleRowMouseLeave = () => {
      deactivateRowHover();
    };

    const handleFocusIn = () => {
      activateHoveredRow(resolvedRowId, syncPosition);
    };

    const handleFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) {
        return;
      }
      deactivateHoveredRow();
    };

    syncPosition();

    row.addEventListener('mousemove', handleRowMouseMove);
    row.addEventListener('mouseleave', handleRowMouseLeave);
    row.addEventListener('focusin', handleFocusIn);
    row.addEventListener('focusout', handleFocusOut);
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('resize', syncPosition);
    window.addEventListener('scroll', syncPosition, true);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(syncPosition);
      resizeObserver.observe(row);
    }

    return () => {
      row.removeEventListener('mousemove', handleRowMouseMove);
      row.removeEventListener('mouseleave', handleRowMouseLeave);
      row.removeEventListener('focusin', handleFocusIn);
      row.removeEventListener('focusout', handleFocusOut);
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('resize', syncPosition);
      window.removeEventListener('scroll', syncPosition, true);
      resizeObserver?.disconnect();
      clearHoverExitTimer();
    };
  }, [
    activateHoveredRow,
    deactivateHoveredRow,
    armHoverGrace,
    clearHoverExitTimer,
    launcherOffset,
    triggerCenterX,
    triggerCenterY,
    wrapperHeight,
    wrapperWidth,
  ]);

  // === GLOBAL OWNERSHIP EVENTS ===

  // --- Global ownership event listeners ---
  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleOpenChange = (event: Event) => {
      const detail = (event as CustomEvent<LauncherActiveChangeDetail>).detail;
      setActiveLauncherRowId(detail?.rowId ?? null);
    };
    const handleOwnerChange = (event: Event) => {
      const detail = (event as CustomEvent<LauncherActiveChangeDetail>).detail;
      setOwnerLauncherRowId(detail?.rowId ?? null);
    };

    window.addEventListener(LAUNCHER_OPEN_EVENT, handleOpenChange as EventListener);
    window.addEventListener(LAUNCHER_OWNER_EVENT, handleOwnerChange as EventListener);
    return () => {
      window.removeEventListener(LAUNCHER_OPEN_EVENT, handleOpenChange as EventListener);
      window.removeEventListener(LAUNCHER_OWNER_EVENT, handleOwnerChange as EventListener);
    };
  }, []);

  // --- Broadcast open state changes ---
  React.useEffect(() => {
    if (!rowId || !isOpen) {
      return;
    }

    dispatchLauncherOpenChange(rowId);
    return () => {
      dispatchLauncherOpenChange(null);
    };
  }, [isOpen, rowId]);

  // === TRIGGER VISIBILITY LOGIC ===

  const canRevealTrigger = resolveLauncherTriggerVisibility({
    hasQuickActions,
    supportsHoverFine,
    isOpen,
    isLauncherHovered,
    isRowHovered,
    isHoverGraceActive,
    rowId,
    activeLauncherRowId,
    ownerLauncherRowId,
  });

  const { phase, showTrigger } = usePatientRowOrbitalLauncherMachine({
    canRevealTrigger,
    isOpen,
    supportsHoverFine,
  });

  // === RETURN VALUE ===

  return {
    anchorRef,
    position,
    phase,
    showTrigger,
    supportsHoverFine,
    handleLauncherMouseEnter: () => {
      claimLauncherOwnership(rowId);
      setIsLauncherHovered(true);
    },
    handleLauncherMouseLeave: releaseLauncherHover,
  };
};
