import React from 'react';
import clsx from 'clsx';
import { ChevronDown, Loader2, Save, CheckCircle, Send, Printer } from 'lucide-react';
import {
  resolveSaveButtonUiState,
  resolveEmailButtonUiState,
} from './actions/dateStripActionStateController';
import type { EmailStatus } from './actions/types';

// Shared visual controls; menus and action orchestration stay in their lazy owners.
export const SaveButton = ({
  onClick,
  disabled,
  isBackingUp = false,
  isArchived = false,
  isOpen = false,
  controlsId,
}: {
  onClick?: () => void;
  disabled?: boolean;
  isBackingUp?: boolean;
  isArchived?: boolean;
  isOpen?: boolean;
  controlsId?: string;
}) => {
  const uiState = resolveSaveButtonUiState({ isArchived, isBackingUp, variant: 'census' });
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isBackingUp}
      className={clsx(
        'hhr-toolbar-control hhr-toolbar-save btn h-[30px] !px-0 !py-0 text-[10px] flex items-center justify-center transition-all',
        uiState.buttonClassName,
        uiState.widthClassName
      )}
      title="Opciones de guardado"
      aria-label={uiState.label}
      aria-expanded={isOpen}
      aria-controls={isOpen ? controlsId : undefined}
      data-save-status={isBackingUp ? 'loading' : isArchived ? 'archived' : 'idle'}
    >
      {uiState.iconKind === 'loading' && (
        <Loader2 size={13} className="animate-spin" aria-hidden="true" />
      )}
      {uiState.iconKind === 'archived' && <CheckCircle size={13} aria-hidden="true" />}
      {uiState.iconKind === 'default' && <Save size={13} aria-hidden="true" />}
    </button>
  );
};
export const EmailButton = ({
  onClick,
  disabled,
  emailStatus = 'idle',
  emailErrorMessage,
  isOpen = false,
  controlsId,
}: {
  onClick?: () => void;
  disabled?: boolean;
  emailStatus?: EmailStatus;
  emailErrorMessage?: string | null;
  isOpen?: boolean;
  controlsId?: string;
}) => {
  const uiState = resolveEmailButtonUiState({
    status: emailStatus,
    errorMessage: emailErrorMessage,
  });
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || emailStatus === 'loading'}
      className={clsx(
        'hhr-toolbar-control btn h-[30px] !py-0 text-[10px] flex items-center justify-center gap-1',
        '!px-2 rounded-lg border-r',
        uiState.buttonClassName,
        uiState.widthClassName
      )}
      title={uiState.title}
      aria-live="polite"
      aria-expanded={isOpen}
      aria-controls={isOpen ? controlsId : undefined}
      data-email-status={emailStatus}
    >
      <Send size={13} aria-hidden="true" />
      {uiState.label}
      <ChevronDown
        size={13}
        aria-hidden="true"
        className={clsx('transition-transform', isOpen && 'rotate-180')}
      />
    </button>
  );
};
export const BookmarkButton = ({
  onToggleBookmarks,
  showBookmarks,
  disabled,
}: {
  onToggleBookmarks?: () => void;
  showBookmarks?: boolean;
  disabled?: boolean;
}) => (
  <button
    disabled={disabled}
    onClick={onToggleBookmarks}
    className={clsx(
      'p-1.5 rounded-lg transition-all shrink-0',
      showBookmarks
        ? 'text-medical-600 bg-medical-50'
        : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
    )}
    title={showBookmarks ? 'Ocultar Marcadores' : 'Mostrar Marcadores'}
  >
    <ChevronDown
      size={16}
      className={clsx(
        'transition-transform duration-300',
        showBookmarks ? 'rotate-180 text-medical-600' : 'text-slate-400'
      )}
    />
  </button>
);
export const PdfButton = ({
  onExportPDF,
  disabled,
}: {
  onExportPDF?: () => void;
  disabled?: boolean;
}) => (
  <div className="flex items-center gap-1">
    <button
      disabled={disabled}
      onClick={onExportPDF}
      className="hhr-toolbar-control btn btn-secondary h-[30px] bg-teal-600 text-white hover:bg-teal-700 border-none !px-2.5 !py-0 text-[10px] rounded-lg"
      title="Descargar PDF (rápido)"
    >
      <Printer size={13} />
      PDF
    </button>
  </div>
);
