/**
 * useUpcChecklistController — Orchestrates state + portal positioning.
 *
 * Follows the 3-layer pattern (like DeliveryRoutePopover):
 *  1. useUpcChecklistState   — draft state, toggles, save/clear
 *  2. this controller        — open/close, popover position, wiring
 *  3. UpcChecklistPopover    — React component with portal
 */

import { useCallback, useRef, useState } from 'react';
import { usePortalPopoverRuntime } from '@/hooks/usePortalPopoverRuntime';
import { useUpcChecklistState } from './useUpcChecklistState';
import type { UpcEvaluationContext } from './useUpcChecklistState';
import { resolveUpcChecklistPopoverPosition } from '@/features/census/controllers/upcChecklistPopoverController';
import type { UpcChecklistRecord, UpcChecklistAuditActor } from '@/domain/upc/upcContracts';

export type { UpcChecklistAuditActor } from '@/domain/upc/upcContracts';

interface UseUpcChecklistControllerParams {
  checklist: UpcChecklistRecord | undefined;
  onSave: (record: UpcChecklistRecord) => Promise<boolean>;
  evaluationContext: UpcEvaluationContext;
  disabled: boolean;
  /** Whether UCI criteria are allowed for this bed (false for Neo1/Neo2). */
  uciAllowed: boolean;
  /** Authenticated user for audit trail. */
  actor: UpcChecklistAuditActor | null;
}

export const useUpcChecklistController = ({
  checklist,
  onSave,
  disabled,
  uciAllowed,
  actor,
  evaluationContext,
}: UseUpcChecklistControllerParams) => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const state = useUpcChecklistState({
    checklist,
    onSave: async record => {
      const confirmed = await onSave(record);
      if (confirmed) {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
      return confirmed;
    },
    uciAllowed,
    actor,
    evaluationContext,
  });

  const closePopover = useCallback(() => setIsOpen(false), []);

  const resolvePosition = useCallback(() => {
    if (!buttonRef.current) return null;
    return resolveUpcChecklistPopoverPosition({
      buttonRect: buttonRef.current.getBoundingClientRect(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      panelHeight: popoverRef.current?.getBoundingClientRect().height || undefined,
      toolbarBottom: Math.max(
        0,
        ...Array.from(document.querySelectorAll('[data-app-top-bar]'), bar => {
          const rect = bar.getBoundingClientRect();
          return rect.height > 0 && rect.top < window.innerHeight ? rect.bottom : 0;
        })
      ),
    });
  }, []);

  const { position: popoverPos, updatePosition } = usePortalPopoverRuntime({
    isOpen,
    anchorRef: buttonRef,
    popoverRef,
    initialPosition: { top: 0, left: 0 },
    resolvePosition,
    onClose: closePopover,
    closeOnScroll: false,
    closeOnOutsideClick: true,
    closeOnEscape: true,
  });

  const togglePopover = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (disabled) return;
      if (!isOpen) {
        state.resetFromPersisted();
        updatePosition();
      }
      setIsOpen(prev => !prev);
    },
    [disabled, isOpen, state, updatePosition]
  );

  return {
    ...state,
    isOpen,
    buttonRef,
    popoverRef,
    popoverPos,
    togglePopover,
    closePopover,
    uciAllowed,
    persistedChecklist: state.persistedChecklist,
    // Delegated from state hook
    draftUci: state.draftUci,
    draftUti: state.draftUti,
    draftClassification: state.draftClassification,
    hasDraftCriteria: state.hasDraftCriteria,
    toggleUciCriterion: state.toggleUciCriterion,
    toggleUtiCriterion: state.toggleUtiCriterion,
  };
};
