import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, MoreVertical, Pencil, Repeat2, RotateCcw, Trash2 } from 'lucide-react';
import type { CensusMovementActionViewModel } from '@/features/census/hooks/useCensusMovementActionsCellModel';

interface CensusMovementActionsMenuProps {
  actions: CensusMovementActionViewModel[];
}

const iconByKind: Record<CensusMovementActionViewModel['iconName'], React.ReactNode> = {
  undo: <RotateCcw size={14} />,
  viewDocuments: <FileText size={14} />,
  edit: <Pencil size={14} />,
  delete: <Trash2 size={14} />,
  convert: <Repeat2 size={14} />,
};

const actionTextClassName = (kind: CensusMovementActionViewModel['kind']): string => {
  if (kind === 'delete') return 'text-red-700 hover:bg-red-50';
  if (kind === 'viewDocuments') return 'text-blue-700 hover:bg-blue-50';
  if (kind === 'convert') return 'text-orange-700 hover:bg-orange-50';
  if (kind === 'edit') return 'text-medical-700 hover:bg-medical-50';
  return 'text-slate-700 hover:bg-slate-50';
};

export const CensusMovementActionsMenu: React.FC<CensusMovementActionsMenuProps> = ({
  actions,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<React.CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const updateMenuPosition = useCallback(() => {
    const trigger = rootRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    setMenuPosition({
      position: 'fixed',
      top: rect.bottom + 4,
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };
    const handleReposition = () => updateMenuPosition();

    updateMenuPosition();
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [isOpen, updateMenuPosition]);

  const handleActionClick = useCallback((action: CensusMovementActionViewModel) => {
    setIsOpen(false);
    action.onClick();
  }, []);

  if (actions.length === 0) return null;

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setIsOpen(value => !value)}
        className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700"
        title="Abrir menú de acciones"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <MoreVertical size={15} />
      </button>
      {isOpen &&
        menuPosition &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={menuPosition}
            className="z-[70] min-w-44 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg print:hidden"
          >
            {actions.map(action => (
              <button
                key={action.key}
                type="button"
                role="menuitem"
                onClick={() => handleActionClick(action)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium ${actionTextClassName(action.kind)}`}
              >
                {iconByKind[action.iconName]}
                <span>{action.title}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
};
