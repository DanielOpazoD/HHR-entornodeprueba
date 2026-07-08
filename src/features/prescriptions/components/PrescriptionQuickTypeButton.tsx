import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Loader2 } from 'lucide-react';
import {
  PRESCRIPTION_TYPES,
  PRESCRIPTION_TYPE_LABELS,
  type PrescriptionType,
} from '@/types/prescriptionTypes';

interface PrescriptionQuickTypeButtonProps {
  currentType: PrescriptionType;
  onChange: (nextType: PrescriptionType) => Promise<void>;
  /**
   * `chip` (default): full-width pill suitable for the unassigned cards.
   * `inline`: tighter button suitable for cells inside the bed grid.
   */
  variant?: 'chip' | 'inline';
}

const TYPE_SHORT_LABEL: Record<PrescriptionType, string> = {
  comun: 'Común',
  psicotropicos: 'Blanca',
  benzodiazepinas: 'Verde',
};

const MENU_ESTIMATED_HEIGHT_PX = 180;
const MENU_GAP_PX = 6;
const VIEWPORT_MARGIN_PX = 8;

export const PrescriptionQuickTypeButton: React.FC<PrescriptionQuickTypeButtonProps> = ({
  currentType,
  onChange,
  variant = 'chip',
}) => {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const updateMenuStyle = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const spaceBelow = viewportHeight - rect.bottom;
      const opensAbove =
        spaceBelow < MENU_ESTIMATED_HEIGHT_PX + MENU_GAP_PX &&
        rect.top > MENU_ESTIMATED_HEIGHT_PX + MENU_GAP_PX;
      const top = opensAbove
        ? Math.max(VIEWPORT_MARGIN_PX, rect.top - MENU_ESTIMATED_HEIGHT_PX - MENU_GAP_PX)
        : Math.min(
            rect.bottom + MENU_GAP_PX,
            Math.max(
              VIEWPORT_MARGIN_PX,
              viewportHeight - MENU_ESTIMATED_HEIGHT_PX - VIEWPORT_MARGIN_PX
            )
          );
      setMenuStyle({
        left: rect.left + rect.width / 2,
        top,
        transform: 'translateX(-50%)',
      });
    };
    updateMenuStyle();
    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClickOutside);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', updateMenuStyle, true);
    window.addEventListener('resize', updateMenuStyle);
    return () => {
      window.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', updateMenuStyle, true);
      window.removeEventListener('resize', updateMenuStyle);
    };
  }, [open]);

  const pickType = async (next: PrescriptionType) => {
    if (next === currentType) {
      setOpen(false);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onChange(next);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo cambiar el tipo.');
    } finally {
      setPending(false);
    }
  };

  const triggerClass =
    variant === 'inline'
      ? 'inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60'
      : 'inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        disabled={pending}
        title="Cambiar tipo de receta"
        className={triggerClass}
      >
        {pending ? <Loader2 size={10} className="animate-spin" /> : <ChevronDown size={10} />}
        {TYPE_SHORT_LABEL[currentType]}
      </button>

      {open &&
        !pending &&
        menuStyle &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={menuStyle}
            className="fixed z-[230] max-h-[min(180px,calc(100vh-16px))] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
            data-placement={
              Number(menuStyle.top) < (containerRef.current?.getBoundingClientRect().top ?? 0)
                ? 'top'
                : 'bottom'
            }
            aria-label="Tipo de receta"
            data-testid="prescription-type-menu"
          >
            <p className="px-2 pt-1 pb-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">
              Tipo de receta
            </p>
            {PRESCRIPTION_TYPES.map(type => {
              const isCurrent = type === currentType;
              return (
                <button
                  key={type}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isCurrent}
                  onClick={() => pickType(type)}
                  disabled={pending}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors ${
                    isCurrent ? 'bg-sky-50 text-sky-900' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span>{PRESCRIPTION_TYPE_LABELS[type]}</span>
                  {isCurrent && <span className="text-[9px] text-sky-700">actual</span>}
                </button>
              );
            })}
            {error && (
              <p role="alert" className="mt-1 px-2 py-1 text-[10px] text-red-700">
                {error}
              </p>
            )}
          </div>,
          document.body
        )}
    </div>
  );
};
