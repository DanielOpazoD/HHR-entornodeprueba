import React, { useCallback, useRef } from 'react';
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
      className="fixed z-[100] max-h-[calc(100vh-16px)] overflow-y-auto print:hidden"
      style={position}
      data-testid="patient-row-menu-portal"
      // Preserve the anchor's existing outside-click handling, including lazy loading.
      onMouseDown={event => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
};
