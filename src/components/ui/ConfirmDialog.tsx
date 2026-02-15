import React from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { useScrollLock } from '@/hooks/useScrollLock';
import type { DialogState } from '@/context/uiContracts';

interface ConfirmDialogProps {
  dialog: DialogState;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ dialog, onConfirm, onCancel }) => {
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

  // Manage body scroll lock
  useScrollLock(dialog.isOpen);

  if (!dialog.isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] animate-fade-in"
      onClick={e => {
        if (e.target === e.currentTarget && !dialog.isAlert) {
          onCancel();
        }
      }}
    >
      <div
        className={`bg-white rounded-lg shadow-xl max-w-sm w-full mx-4 overflow-hidden border ${styles.border} animate-scale-in`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`px-4 py-2 ${styles.bg} border-b ${styles.border} flex items-center gap-2`}>
          <AlertTriangle className={styles.icon} size={16} />
          <h3 className="font-semibold text-sm text-slate-800">{dialog.title}</h3>
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
          <p className="text-xs text-slate-600 whitespace-pre-line">{dialog.message}</p>
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
            className={`px-3 py-1.5 text-xs rounded font-medium transition-colors ${styles.button}`}
            autoFocus
          >
            {dialog.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
