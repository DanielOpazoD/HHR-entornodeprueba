import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';
import type { CensusMovementActionViewModel } from '@/features/census/hooks/useCensusMovementActionsCellModel';
import type { CensusMovementRowBaseViewModel } from '@/features/census/types/censusMovementRowViewModelTypes';
import { formatCensusPatientName } from '@/utils/patientNameDisplayUtils';
import {
  MOVEMENT_ACTION_BUTTON_CLASS,
  renderCensusMovementActionIcon,
} from './censusMovementActionPresentation';

export type CensusMovementMenuContext = Pick<
  CensusMovementRowBaseViewModel,
  'bedName' | 'patientName'
>;

interface CensusMovementActionsMenuProps {
  actions: CensusMovementActionViewModel[];
  context: CensusMovementMenuContext;
}

const isFinalAction = ({ kind }: CensusMovementActionViewModel) =>
  kind === 'undo' || kind === 'delete';

const actionTextClassName = (kind: CensusMovementActionViewModel['kind']): string => {
  if (kind === 'delete') return 'text-red-700 hover:bg-red-50';
  if (kind === 'viewDocuments') return 'text-blue-700 hover:bg-blue-50';
  if (kind === 'hospitalizationReports') return 'text-sky-700 hover:bg-sky-50';
  if (kind === 'convert') return 'text-orange-700 hover:bg-orange-50';
  if (kind === 'edit') return 'text-medical-700 hover:bg-medical-50';
  return 'text-slate-700 hover:bg-slate-50';
};

const VIEWPORT_PADDING = 8;
const MENU_GAP = 4;

export const resolveMenuPosition = (
  anchorRect: DOMRect,
  menuRect: DOMRect,
  viewportSize: { width: number; height: number }
): React.CSSProperties => {
  const width = menuRect.width || 0;
  const height = menuRect.height || 0;

  const spaceBelow = viewportSize.height - anchorRect.bottom - MENU_GAP;
  const openBelowTop = anchorRect.bottom + MENU_GAP;
  const openAboveTop = anchorRect.top - height - MENU_GAP;

  const preferredTop = height > 0 && height > spaceBelow ? openAboveTop : openBelowTop;
  const minTop = VIEWPORT_PADDING;
  const maxTop = viewportSize.height - height - VIEWPORT_PADDING;

  return {
    position: 'fixed',
    top: `${Math.max(minTop, Math.min(preferredTop, maxTop))}px`,
    right: `${Math.max(
      VIEWPORT_PADDING,
      Math.min(
        viewportSize.width - anchorRect.right - MENU_GAP,
        viewportSize.width - width - VIEWPORT_PADDING
      )
    )}px`,
    left: width > viewportSize.width - VIEWPORT_PADDING * 2 ? `${VIEWPORT_PADDING}px` : undefined,
  };
};

export const CensusMovementActionsMenu: React.FC<CensusMovementActionsMenuProps> = ({
  actions,
  context,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<React.CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const patientName = formatCensusPatientName(context.patientName) || '—';
  const bedName = context.bedName || '—';
  const actionGroups = [
    actions.filter(action => !isFinalAction(action)),
    actions.filter(isFinalAction),
  ].filter(group => group.length > 0);

  const updateMenuPosition = useCallback(() => {
    const trigger = rootRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const menuRect = menuRef.current?.getBoundingClientRect() ?? new DOMRect();
    setMenuPosition(
      resolveMenuPosition(rect, menuRect, {
        width: window.innerWidth,
        height: window.innerHeight,
      })
    );
  }, []);

  const setMenuNode = useCallback(
    (node: HTMLDivElement | null) => {
      menuRef.current = node;
      if (node) {
        updateMenuPosition();
      }
    },
    [updateMenuPosition]
  );

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
        className={`${MOVEMENT_ACTION_BUTTON_CLASS} w-8`}
        title="Abrir menú de acciones"
        aria-label={`Acciones de ${patientName} en ${bedName}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <MoreVertical size={16} aria-hidden="true" />
      </button>
      {isOpen &&
        menuPosition &&
        createPortal(
          <div
            ref={setMenuNode}
            role="menu"
            aria-label={`Acciones de ${patientName} en ${bedName}`}
            style={menuPosition}
            className="z-[70] w-64 max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-y-auto overflow-x-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg print:hidden"
          >
            <div className="border-b border-slate-100 px-3 py-2">
              <p className="text-[10px] font-semibold text-slate-500">{bedName}</p>
              <p className="mt-0.5 break-words text-xs font-semibold text-slate-700">
                {patientName}
              </p>
            </div>
            {actionGroups.map((group, index) => (
              <React.Fragment key={index}>
                {index > 0 && <div role="separator" className="my-1 border-t border-slate-100" />}
                {group.map(action => (
                  <button
                    key={action.key}
                    type="button"
                    role="menuitem"
                    onClick={() => handleActionClick(action)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium ${actionTextClassName(action.kind)}`}
                  >
                    {renderCensusMovementActionIcon(action.kind)}
                    <span>{action.title}</span>
                  </button>
                ))}
              </React.Fragment>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
};
