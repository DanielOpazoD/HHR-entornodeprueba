import React, { useEffect, useId, useRef } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';

export const CensusOptionsMenu: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isOpen, menuRef, toggle, close } = useDropdownMenu();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    const root = menuRef.current;
    // Native bubbling includes the census-owned handoff portal, too.
    const onAction = (event: MouseEvent) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(
        'button[data-census-menu-action]'
      );
      if (button && !button.disabled && root?.contains(button)) {
        triggerRef.current?.focus();
        close();
      }
    };
    root?.addEventListener('click', onAction);
    return () => root?.removeEventListener('click', onAction);
  }, [close, menuRef]);
  return (
    <div
      ref={menuRef}
      className="relative self-center"
      data-overlay-open={isOpen ? 'true' : undefined}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          close();
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-label="Más opciones del censo"
        title="Más opciones del censo"
        className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
      >
        <MoreHorizontal size={17} aria-hidden="true" />
      </button>
      {/* Keep owners mounted when closed so an opened modal or request is not discarded. */}
      <div
        id={panelId}
        hidden={!isOpen}
        role="group"
        aria-label="Opciones del censo"
        className="absolute right-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg [&_[data-census-menu-action]]:!flex [&_[data-census-menu-action]]:!h-auto [&_[data-census-menu-action]]:!min-h-8 [&_[data-census-menu-action]]:!w-full [&_[data-census-menu-action]]:!justify-start [&_[data-census-menu-action]]:!border-0 [&_[data-census-menu-action]]:!bg-transparent [&_[data-census-menu-action]]:!px-2 [&_[data-census-menu-action]]:!py-2 [&_[data-census-menu-action]]:!text-xs [&_[data-census-menu-action]>span]:!inline [&_[data-census-menu-action]:hover]:!bg-slate-50"
      >
        {children}
      </div>
    </div>
  );
};
