import React from 'react';
import clsx from 'clsx';
import { Archive, CheckCheck, Eye, FileDown, Trash2, Undo2, XCircle } from 'lucide-react';
import type { TransferRequest } from '@/types/transferRequestTypes';
import type { TransferRowActionState } from '../controllers/transferTableController';

/**
 * The questionnaire/document-package workflow still exists in the feature, but
 * the public table action to prepare/edit that package is intentionally hidden.
 * Keep this constant and the README note aligned so the mode is not recreated.
 */
const SHOW_PREPARE_TRANSFER_DOCS_ACTION = false;

interface TransferTableRowActionsProps {
  transfer: TransferRequest;
  actionState: TransferRowActionState;
  hasDocumentSupport: boolean;
  onGenerateDocs: (transfer: TransferRequest) => void;
  onViewDocs: (transfer: TransferRequest) => void;
  onMarkTransferred: (transfer: TransferRequest) => void;
  onUndo: (transfer: TransferRequest) => void;
  onArchive: (transfer: TransferRequest) => void;
  onDeleteFinalized: (transfer: TransferRequest) => void;
  onOpenCloseMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export const TransferTableRowActions: React.FC<TransferTableRowActionsProps> = ({
  transfer,
  actionState,
  hasDocumentSupport,
  onGenerateDocs,
  onViewDocs,
  onMarkTransferred,
  onUndo,
  onArchive,
  onDeleteFinalized,
  onOpenCloseMenu,
}) => (
  <div className="flex flex-wrap items-center gap-1.5">
    {SHOW_PREPARE_TRANSFER_DOCS_ACTION && actionState.canPrepareDocuments && (
      <button
        onClick={() => onGenerateDocs(transfer)}
        disabled={!hasDocumentSupport}
        className={clsx(
          'flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-all',
          !hasDocumentSupport && 'cursor-not-allowed opacity-50',
          transfer.questionnaireResponses
            ? 'border border-indigo-100 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
            : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
        )}
        title={
          !hasDocumentSupport
            ? 'Este hospital aún no tiene formularios configurados'
            : transfer.questionnaireResponses
              ? 'Seguir editando datos'
              : 'Preparar datos para documentos'
        }
      >
        <FileDown size={14} />
        {transfer.questionnaireResponses ? 'Editar' : 'Preparar docs'}
      </button>
    )}

    {actionState.canViewDocuments && (
      <button
        onClick={() => onViewDocs(transfer)}
        disabled={!hasDocumentSupport}
        className={clsx(
          'flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-all shadow-sm',
          !hasDocumentSupport
            ? 'cursor-not-allowed bg-slate-100 text-slate-400 shadow-none'
            : 'bg-slate-900 text-white hover:bg-slate-800'
        )}
        title={
          hasDocumentSupport
            ? 'Ver documentos generados'
            : 'Este hospital aún no tiene formularios configurados'
        }
      >
        <Eye size={14} /> Ver docs
      </button>
    )}

    {actionState.canMarkTransferred && (
      <button
        onClick={() => onMarkTransferred(transfer)}
        className="flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] font-semibold text-emerald-700 transition-all hover:bg-emerald-100"
        title="Configurar traslado como completado (egreso)"
      >
        <CheckCheck size={14} /> Completar traslado
      </button>
    )}

    {actionState.canUndoTransfer && (
      <button
        onClick={() => onUndo(transfer)}
        className="flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-700 transition-all hover:bg-amber-100"
        title="Deshacer traslado (volver a estado anterior)"
      >
        <Undo2 size={14} /> Deshacer
      </button>
    )}

    {actionState.canArchiveTransfer && (
      <button
        onClick={() => onArchive(transfer)}
        className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2 py-1.5 text-[11px] font-semibold text-slate-600 transition-all hover:bg-slate-200"
        title="Archivar (quitar de la lista)"
      >
        <Archive size={14} /> Archivar
      </button>
    )}

    {actionState.canDeleteFinalizedTransfer && (
      <button
        onClick={() => onDeleteFinalized(transfer)}
        className="flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] font-semibold text-red-600 transition-all hover:bg-red-100"
        title="Eliminar registro permanentemente"
      >
        <Trash2 size={14} /> Eliminar
      </button>
    )}

    {(actionState.canCancelTransfer || actionState.canDeleteTransfer) && (
      <div className="relative ml-auto" data-transfer-actions-root="true">
        <button
          onClick={onOpenCloseMenu}
          className="shrink-0 rounded-md p-1 text-rose-600 transition-colors hover:bg-rose-50 hover:text-rose-700"
          title="Opciones de cierre"
        >
          <XCircle size={16} />
        </button>
      </div>
    )}
  </div>
);
