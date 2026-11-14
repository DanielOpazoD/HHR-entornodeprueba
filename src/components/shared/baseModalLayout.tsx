import React from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { buttonClassName } from '@/components/ui/base/buttonStyles';
import {
  PANEL_HEADER_CLASS,
  PANEL_TITLE_CLASS,
  PANEL_ICON_CLASS,
} from '@/components/ui/base/panelStyles';

interface BaseModalBackdropProps {
  printable: boolean;
  scrollableBody: boolean;
  zIndex?: number;
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}

export const BaseModalBackdrop: React.FC<BaseModalBackdropProps> = ({
  printable,
  scrollableBody,
  zIndex,
  onClick,
  children,
}) => (
  <div
    data-printable-modal-root={printable ? '' : undefined}
    className={clsx(
      'fixed inset-0 bg-slate-900/60 z-[100] backdrop-blur-sm animate-fade-in',
      scrollableBody ? 'flex items-center justify-center p-4' : 'overflow-y-auto p-4',
      !printable && 'print:hidden'
    )}
    style={{ isolation: 'isolate', zIndex }}
    onClick={onClick}
  >
    {children}
  </div>
);

interface BaseModalHeaderProps {
  titleId: string;
  title: React.ReactNode;
  icon?: React.ReactNode;
  onClose: () => void;
  showCloseButton: boolean;
  headerIconColor: string;
  variant: 'glass' | 'white';
  headerActions?: React.ReactNode;
}

export const BaseModalHeader: React.FC<BaseModalHeaderProps> = ({
  titleId,
  title,
  icon,
  onClose,
  showCloseButton,
  headerIconColor,
  variant,
  headerActions,
}) => (
  <div
    className={clsx(
      PANEL_HEADER_CLASS,
      'px-4 sticky top-0 z-10',
      variant === 'white' ? 'bg-white border-slate-100' : 'bg-white/30 border-white/20'
    )}
  >
    <h3 id={titleId} className={`${PANEL_TITLE_CLASS} flex items-center gap-2`}>
      {/* One header pattern: the tool's icon, in its own colour, on a neutral badge. */}
      {icon && <span className={clsx(PANEL_ICON_CLASS, headerIconColor)}>{icon}</span>}
      <span className="min-w-0 break-words">{title}</span>
    </h3>
    <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
      {headerActions && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">{headerActions}</div>
      )}
      {showCloseButton && (
        <button
          onClick={onClose}
          type="button"
          className={buttonClassName('ghost', 'icon', 'shrink-0')}
          aria-label="Cerrar modal"
        >
          <X size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  </div>
);

interface BaseModalBodyProps {
  scrollableBody: boolean;
  bodyClassName?: string;
  children: React.ReactNode;
}

export const BaseModalBody: React.FC<BaseModalBodyProps> = ({
  scrollableBody,
  bodyClassName,
  children,
}) => (
  <div
    className={clsx(
      scrollableBody ? 'max-h-[70vh] overflow-y-auto' : 'overflow-visible',
      bodyClassName || 'p-6 space-y-6'
    )}
  >
    {children}
  </div>
);
