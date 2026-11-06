import React, { useEffect, useId, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';

/** Anchored to the relative study metadata row so the warning stays inside its card. */
export const ClinicalExplorerIdentityNotice: React.FC<{ message: string }> = ({ message }) => {
  const id = useId();
  const containerRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    const dismissOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', dismiss, true);
    document.addEventListener('pointerdown', dismissOutside);
    return () => {
      document.removeEventListener('keydown', dismiss, true);
      document.removeEventListener('pointerdown', dismissOutside);
    };
  }, [open]);
  return (
    <span
      ref={containerRef}
      className="inline-flex align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={event => {
        if (!event.currentTarget.contains(document.activeElement)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label="Advertencia de identificación del estudio"
        aria-describedby={open ? id : undefined}
        className="inline-flex size-6 items-center justify-center rounded text-amber-700 hover:bg-amber-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-700"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
      >
        <TriangleAlert size={14} aria-hidden="true" />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-0 top-full z-40 w-[min(20rem,100%)] pt-1"
        >
          <span className="block rounded-lg border border-slate-200 bg-white p-3 text-[12px] font-normal leading-relaxed text-slate-700 shadow-lg">
            {message}
          </span>
        </span>
      )}
    </span>
  );
};
