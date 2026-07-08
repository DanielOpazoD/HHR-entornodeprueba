import React from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { useScrollLock } from '@/hooks/useScrollLock';
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
      button: 'bg-amber-600 hover:bg-amber-700 text-white',
    },
    info: {
      icon: 'text-blue-600',
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      button: 'bg-blue-600 hover:bg-blue-700 text-white',
    },
  };

  const styles = variantStyles[dialog.variant];

  useScrollLock(dialog.isOpen);

  if (!dialog.isOpen) return null;

  const requiresInput = !!dialog.requireInputConfirm;
  const normalize = (value: string) =>
    dialog.inputConfirmCaseSensitive ? value.trim() : value.trim().toLowerCase();
  const isInputValid =
    !requiresInput || normalize(inputValue) === normalize(dialog.requireInputConfirm ?? '');

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] animate-fade-in no-print"
      onClick={e => {
        if (e.target === e.currentTarget && !dialog.isAlert) {
          onCancel();
        }
      }}
    >
      <div
        className={`bg-white rounded-lg shadow-xl max-w-sm w-full mx-4 overflow-hidden border ${styles.border} animate-scale-in`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={e => e.stopPropagation()}
      >
        <div className={`px-4 py-2 ${styles.bg} border-b ${styles.border} flex items-center gap-2`}>
          <AlertTriangle className={styles.icon} size={16} />
          <h3 id="confirm-dialog-title" className="font-semibold text-sm text-slate-800">
            {dialog.title}
          </h3>
          {!dialog.isAlert && (
            <button
              onClick={onCancel}
              className="ml-auto text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-slate-600 whitespace-pre-line mb-3">{dialog.message}</p>
          {requiresInput && (
            <div className="mt-2">
              <p className="text-xs text-slate-700 font-medium mb-1">
                Escriba <strong>{dialog.requireInputConfirm}</strong> para confirmar:
              </p>
              <input
                type="text"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                className="input w-full text-xs font-mono"
                placeholder={dialog.requireInputConfirm}
                autoFocus
              />
            </div>
          )}
        </div>
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
          {!dialog.isAlert && (
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded transition-colors font-medium"
            >
              {dialog.cancelText}
            </button>
          )}
          <button
            onClick={onConfirm}
            disabled={!isInputValid}
            className={`px-3 py-1.5 text-xs rounded font-medium transition-colors ${styles.button} ${!isInputValid ? 'opacity-50 cursor-not-allowed' : ''}`}
            autoFocus={!requiresInput}
          >
            {dialog.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
