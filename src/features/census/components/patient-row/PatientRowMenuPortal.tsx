import React, { useCallback, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { usePortalPopoverRuntime } from '@/hooks/usePortalPopoverRuntime';
import type { RowMenuAlign } from './patientRowUiContracts';

interface PatientRowMenuPortalProps {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  align: RowMenuAlign;
  onClose: () => void;
  children: React.ReactNode;
}

/** Row menus must escape the table's horizontal scroll container. */
export const PatientRowMenuPortal: React.FC<PatientRowMenuPortalProps> = ({
  anchorRef,
  align,
  onClose,
  children,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const focusTrigger = () =>
    anchorRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();

  useLayoutEffect(() => {
    const panel = popoverRef.current;
    const trigger = anchorRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
    panel
      ?.querySelector<HTMLButtonElement>('button:not(:disabled):not([aria-disabled="true"])')
      ?.focus();
    return () => {
      if (document.activeElement === document.body || panel?.contains(document.activeElement)) {
        trigger?.focus();
        // An outside mousedown can blur the trigger after the menu unmounts.
        queueMicrotask(() => {
          if (document.activeElement === document.body && trigger?.isConnected) trigger.focus();
        });
      }
    };
  }, [anchorRef]);
  const resolvePosition = useCallback(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    if (!anchor) return null;
    const width = popoverRef.current?.offsetWidth ?? 240;
    const height = popoverRef.current?.offsetHeight ?? 0;
    const top = align === 'top' ? anchor.top : anchor.bottom - height;
    return {
      left: Math.max(8, Math.min(anchor.right + 4, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - height - 8)),
    };
  }, [align, anchorRef]);
  const { position } = usePortalPopoverRuntime({
    isOpen: true,
    anchorRef,
    popoverRef,
    initialPosition: { left: 8, top: 8 },
    resolvePosition,
    onClose,
  });

  return createPortal(
    <div
      ref={popoverRef}
      role="menu"
      className="fixed z-[100] max-h-[calc(100vh-16px)] overflow-y-auto print:hidden"
      style={position}
      data-testid="patient-row-menu-portal"
      // Preserve the anchor's existing outside-click handling, including lazy loading.
      onMouseDown={event => event.stopPropagation()}
      // Modals must remember the persistent trigger before an item's action runs.
      onClickCapture={event => {
        if (event.target instanceof Element && event.target.closest('button:not(:disabled)')) {
          focusTrigger();
        }
      }}
    >
      {children}
    </div>,
    document.body
  );
};
