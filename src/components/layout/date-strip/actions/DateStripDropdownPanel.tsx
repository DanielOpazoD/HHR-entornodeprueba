import React, { useCallback, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { usePortalPopoverRuntime } from '@/hooks/usePortalPopoverRuntime';

interface DateStripDropdownPanelProps {
  title: string;
  widthClassName: string;
  id: string;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  children: React.ReactNode;
  headerAction?: React.ReactNode;
}

export const DateStripDropdownPanel: React.FC<DateStripDropdownPanelProps> = ({
  title,
  widthClassName,
  id,
  anchorRef,
  onClose,
  children,
  headerAction,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const resolvePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return null;
    const bounds = anchor.getBoundingClientRect();
    const margin = 12;
    const gap = 6;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = panelRef.current?.offsetWidth || Math.min(240, viewportWidth - margin * 2);
    const height = panelRef.current?.scrollHeight || 160;
    const below = viewportHeight - bounds.bottom - gap - margin;
    const above = bounds.top - gap - margin;
    const opensAbove = below < Math.min(height, 180) && above > below;
    const maxHeight = Math.max(0, opensAbove ? above : below);
    return {
      left: Math.max(margin, Math.min(bounds.left, viewportWidth - width - margin)),
      top: opensAbove
        ? Math.max(margin, bounds.top - gap - Math.min(height, maxHeight))
        : bounds.bottom + gap,
      maxHeight,
    };
  }, [anchorRef]);
  const { position, updatePosition } = usePortalPopoverRuntime({
    isOpen: true,
    anchorRef,
    popoverRef: panelRef,
    initialPosition: { top: 0, left: 12, maxHeight: 320 },
    resolvePosition,
    onClose,
    closeOnEscape: false,
  });

  useLayoutEffect(() => {
    updatePosition();
    const initialControl = panelRef.current?.querySelector<HTMLElement>('button:not(:disabled)');
    (initialControl ?? panelRef.current)?.focus({ preventScroll: true });
    if (typeof ResizeObserver === 'undefined' || !panelRef.current) return;
    const observer = new ResizeObserver(updatePosition);
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, [updatePosition]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="group"
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
      style={position}
      className={clsx(
        'fixed z-[80] max-w-[calc(100vw-24px)] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white py-1 shadow-xl print:hidden',
        widthClassName
      )}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          anchorRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
        }
      }}
      onBlur={event => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget) &&
          !anchorRef.current?.contains(event.relatedTarget)
        ) {
          onClose();
        }
      }}
    >
      <div className="mb-1 flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <p
          id={`${id}-title`}
          className="text-[11px] font-semibold uppercase tracking-wide text-slate-500"
        >
          {title}
        </p>
        {headerAction}
      </div>
      {children}
    </div>,
    document.body
  );
};
