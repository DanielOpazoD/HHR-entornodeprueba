/**
 * DragDropConfirmation
 *
 * Inline confirmation dialog shown after a patient is dropped
 * onto an empty bed. Displays source/target bed names and patient
 * name, with confirm/cancel buttons.
 */

import React, { useEffect, useRef } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import type { PendingBedMove } from '@/features/census/drag-drop/dragDropContracts';

interface DragDropConfirmationProps {
  move: PendingBedMove;
  onConfirm: () => void;
  onCancel: () => void;
}

export const DragDropConfirmation: React.FC<DragDropConfirmationProps> = ({
  move,
  onConfirm,
  onCancel,
}) => {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Auto-focus confirm button and handle Escape
  useEffect(() => {
    confirmRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-[2px]"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div className="relative bg-white rounded-xl shadow-2xl border border-slate-200 p-5 max-w-sm w-full animate-scale-in">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Confirmar cambio de cama</h3>

        <div className="flex items-center gap-3 bg-slate-50 rounded-lg p-3 mb-4">
          <div className="text-center">
            <span className="text-[10px] text-slate-400 block">Desde</span>
            <span className="text-sm font-bold text-slate-700">{move.sourceBedId}</span>
          </div>
          <ArrowRight size={16} className="text-medical-500 shrink-0" />
          <div className="text-center">
            <span className="text-[10px] text-slate-400 block">Hacia</span>
            <span className="text-sm font-bold text-medical-600">{move.targetBedId}</span>
          </div>
        </div>

        <p className="text-xs text-slate-500 mb-4">
          <span className="font-medium text-slate-700">{move.patientName}</span> sera movido a la
          cama {move.targetBedId}. La cama {move.sourceBedId} quedara vacia.
        </p>

        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X size={13} />
            Cancelar
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors"
          >
            <Check size={13} />
            Mover paciente
          </button>
        </div>
      </div>
    </div>
  );
};
