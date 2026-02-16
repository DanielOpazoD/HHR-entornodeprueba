import React from 'react';
import clsx from 'clsx';
import { Lock } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';

interface BedReasonDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  headerIconColor: string;
  reason: string;
  error: string | null;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  confirmClassName: string;
  onDangerAction?: () => void;
  dangerActionLabel?: string;
}

export const BedReasonDialog: React.FC<BedReasonDialogProps> = ({
  isOpen,
  onClose,
  title,
  headerIconColor,
  reason,
  error,
  onReasonChange,
  onCancel,
  onConfirm,
  confirmLabel,
  confirmClassName,
  onDangerAction,
  dangerActionLabel,
}) => (
  <BaseModal
    isOpen={isOpen}
    onClose={onClose}
    title={title}
    icon={<Lock size={16} />}
    size="sm"
    variant="white"
    headerIconColor={headerIconColor}
  >
    <div className="space-y-6">
      <div>
        <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Motivo del Bloqueo
        </label>
        <input
          autoFocus
          type="text"
          className={clsx(
            'w-full rounded-xl border p-2.5 text-sm text-slate-700 shadow-sm transition-all focus:outline-none focus:ring-2',
            error
              ? 'border-red-300 focus:ring-red-100'
              : 'border-slate-200 focus:border-medical-500 focus:ring-medical-500'
          )}
          placeholder="Ej: Mantención, Aislamiento..."
          value={reason}
          onChange={event => onReasonChange(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && onConfirm()}
        />
        {error && (
          <p className="mt-1.5 animate-fade-in pl-1 text-[10px] font-medium text-red-500">
            {error}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border border-slate-100 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className={clsx(
              'flex-1 rounded-xl py-2 text-sm font-bold text-white transition-all active:scale-95',
              confirmClassName
            )}
          >
            {confirmLabel}
          </button>
        </div>

        {onDangerAction && dangerActionLabel ? (
          <button
            onClick={onDangerAction}
            className="mt-2 w-full rounded-xl border border-red-100 py-2 text-sm font-bold text-red-600 transition-colors hover:bg-red-50"
          >
            {dangerActionLabel}
          </button>
        ) : null}
      </div>
    </div>
  </BaseModal>
);
