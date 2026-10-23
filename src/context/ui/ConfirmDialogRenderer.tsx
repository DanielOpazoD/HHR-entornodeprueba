import React from 'react';
import { X, AlertTriangle, Info } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useBaseModalLifecycle } from '@/components/shared/useBaseModalLifecycle';
import type { DialogState } from '@/context/uiContracts';

interface ConfirmDialogRendererProps {
  dialog: DialogState;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialogRenderer: React.FC<ConfirmDialogRendererProps> = ({
  dialog,
  onConfirm,
  onCancel,
}) => {
  const [inputValue, setInputValue] = React.useState('');
  const titleId = React.useId();
  const messageId = React.useId();
  const inputId = React.useId();
  const { modalRef } = useBaseModalLifecycle({
    isOpen: dialog.isOpen,
    onClose: () => {
      if (!dialog.isAlert) onCancel();
    },
  });

  // Reset input when dialog opens/closes
  React.useEffect(() => {
    if (dialog.isOpen) {
      setInputValue('');
    }
  }, [dialog.isOpen]);
  const variantStyles = {
    danger: {
      icon: 'text-red-600',
      bg: 'bg-red-50',
      border: 'border-red-200',
      button: 'bg-red-600 hover:bg-red-700 text-white',
    },
    warning: {
      icon: 'text-amber-600',
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      button: 'bg-amber-700 hover:bg-amber-800 text-white',
    },
    info: {
      icon: 'text-blue-600',
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      button: 'bg-blue-600 hover:bg-blue-700 text-white',
    },
  };

  const styles = variantStyles[dialog.variant];

  if (!dialog.isOpen || typeof document === 'undefined') return null;

  const requiresInput = !!dialog.requireInputConfirm;
  const normalize = (value: string) =>
    dialog.inputConfirmCaseSensitive ? value.trim() : value.trim().toLowerCase();
  const isInputValid =
    !requiresInput || normalize(inputValue) === normalize(dialog.requireInputConfirm ?? '');

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 animate-fade-in no-print"
      onClick={e => {
        if (e.target === e.currentTarget && !dialog.isAlert) {
          onCancel();
        }
      }}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className={`flex max-h-[calc(100dvh-32px)] w-full max-w-sm flex-col overflow-hidden rounded-xl border bg-white shadow-xl ${styles.border} animate-scale-in`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onClick={e => e.stopPropagation()}
      >
        <div
          className={`flex shrink-0 items-center gap-2 border-b px-4 py-3 ${styles.bg} ${styles.border}`}
        >
          {dialog.variant === 'info' ? (
            <Info className={`shrink-0 ${styles.icon}`} size={18} aria-hidden="true" />
          ) : (
            <AlertTriangle className={`shrink-0 ${styles.icon}`} size={18} aria-hidden="true" />
          )}
          <h3 id={titleId} className="min-w-0 break-words text-sm font-semibold text-slate-800">
            {dialog.title}
          </h3>
          {!dialog.isAlert && (
            <button
              type="button"
              onClick={onCancel}
              className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/70 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600"
              aria-label="Cerrar diálogo"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4">
          <p
            id={messageId}
            className="whitespace-pre-line text-[13px] leading-6 text-slate-600 [overflow-wrap:anywhere]"
          >
            {dialog.message}
          </p>
          {requiresInput && (
            <div className="mt-2">
              <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-slate-700">
                Escriba <strong>{dialog.requireInputConfirm}</strong> para confirmar:
              </label>
              <input
                id={inputId}
                type="text"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                className="input-field w-full font-mono text-xs"
                placeholder={dialog.requireInputConfirm}
                autoFocus
              />
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          {!dialog.isAlert && (
            <button
              type="button"
              onClick={onCancel}
              className="min-h-9 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600"
            >
              {dialog.cancelText}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            disabled={!isInputValid}
            className={`min-h-9 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-medical-600 ${styles.button} ${!isInputValid ? 'opacity-50 cursor-not-allowed' : ''}`}
            autoFocus={!requiresInput}
          >
            {dialog.confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
