import React, { useMemo, useState } from 'react';
import { ChevronDown, Pencil, Plus, Settings2, Trash2, Users, X } from 'lucide-react';
import { ModalSection } from '@/components/shared/baseModalSection';
import type { GlobalEmailRecipientList } from '@/services/email/emailRecipientListService';

interface CensusEmailRecipientsSectionProps {
  safeRecipients: string[];
  visibleRecipients: string[];
  hiddenRecipientsCount: number;
  maxVisibleRecipients: number;
  showAllRecipients: boolean;
  showBulkEditor: boolean;
  recipientLists: GlobalEmailRecipientList[];
  activeRecipientListId: string;
  onActiveRecipientListChange: (listId: string) => void;
  onCreateRecipientList: (name: string) => Promise<void>;
  onRenameRecipientList: (name: string) => Promise<void>;
  onDeleteRecipientList: (listId: string) => Promise<void>;
  recipientsSource: 'firebase' | 'local' | 'default';
  isRecipientsSyncing: boolean;
  recipientsSyncError: string | null;
  bulkRecipients: string;
  newRecipient: string;
  editingIndex: number | null;
  editingValue: string;
  error: string | null;
  onToggleShowAllRecipients: () => void;
  onToggleBulkEditor: () => void;
  onBulkRecipientsChange: (nextValue: string) => void;
  onBulkCancel: () => void;
  onBulkSave: () => void;
  onNewRecipientChange: (nextValue: string) => void;
  onAddRecipient: () => void;
  onStartEditRecipient: (index: number) => void;
  onEditingValueChange: (nextValue: string) => void;
  onSaveEditedRecipient: () => void;
  onCancelEditRecipient: () => void;
  onRemoveRecipient: (index: number) => void;
}

export const CensusEmailRecipientsSection: React.FC<CensusEmailRecipientsSectionProps> = ({
  safeRecipients,
  visibleRecipients,
  hiddenRecipientsCount,
  maxVisibleRecipients,
  showAllRecipients,
  showBulkEditor,
  recipientLists,
  activeRecipientListId,
  onActiveRecipientListChange,
  onCreateRecipientList,
  onRenameRecipientList,
  onDeleteRecipientList,
  recipientsSource,
  isRecipientsSyncing,
  recipientsSyncError,
  bulkRecipients,
  newRecipient,
  editingIndex,
  editingValue,
  error,
  onToggleShowAllRecipients,
  onToggleBulkEditor,
  onBulkRecipientsChange,
  onBulkCancel,
  onBulkSave,
  onNewRecipientChange,
  onAddRecipient,
  onStartEditRecipient,
  onEditingValueChange,
  onSaveEditedRecipient,
  onCancelEditRecipient,
  onRemoveRecipient,
}) => {
  const activeRecipientList = useMemo(
    () => recipientLists.find(list => list.id === activeRecipientListId) ?? null,
    [activeRecipientListId, recipientLists]
  );
  const [listNameDraft, setListNameDraft] = useState(activeRecipientList?.name ?? '');
  const [newListName, setNewListName] = useState('');
  const [showRenamePanel, setShowRenamePanel] = useState(false);
  const [showCreatePanel, setShowCreatePanel] = useState(false);

  return (
    <ModalSection
      title="Destinatarios"
      icon={<Users size={15} className="text-blue-600" />}
      variant="info"
      className="p-3"
    >
      <div className="mb-2 rounded-lg border border-blue-100 bg-blue-50/70 px-2.5 py-2">
        <p className="text-[10px] font-semibold text-blue-900">
          Lista global sincronizada con Firebase
        </p>
        <p className="text-[9px] text-blue-700 mt-0.5 leading-snug">
          {recipientsSource === 'firebase'
            ? 'Estos destinatarios se guardan globalmente y podran reutilizarse en futuras funciones.'
            : recipientsSource === 'local'
              ? 'Se esta usando una copia local mientras se sincroniza o recrea la lista global.'
              : 'Se estan usando destinatarios por defecto hasta crear una lista global.'}
        </p>
        {isRecipientsSyncing && (
          <p className="text-[9px] text-blue-700 mt-1 font-medium">Sincronizando cambios...</p>
        )}
        {recipientsSyncError && (
          <p className="text-[9px] text-amber-700 mt-1 font-medium">{recipientsSyncError}</p>
        )}
      </div>

      <div className="space-y-2 mb-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2.5">
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-slate-700">Lista activa</label>
          <select
            value={activeRecipientListId}
            onChange={event => onActiveRecipientListChange(event.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {recipientLists.map(list => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setListNameDraft(activeRecipientList?.name ?? '');
              setShowRenamePanel(previous => !previous);
              setShowCreatePanel(false);
            }}
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
          >
            <Settings2 size={12} />
            Renombrar
          </button>
          <button
            type="button"
            onClick={() => {
              setShowCreatePanel(previous => !previous);
              setShowRenamePanel(false);
            }}
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
          >
            <Plus size={12} />
            Crear lista
          </button>
          <button
            type="button"
            onClick={() => void onDeleteRecipientList(activeRecipientListId)}
            disabled={recipientLists.length <= 1}
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-[10px] font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={12} />
            Eliminar
          </button>
        </div>

        {showRenamePanel && (
          <div className="grid grid-cols-[1fr_auto] gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2">
            <input
              type="text"
              value={listNameDraft}
              onChange={event => setListNameDraft(event.target.value)}
              placeholder="Nombre de la lista"
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => void onRenameRecipientList(listNameDraft)}
              className="inline-flex items-center justify-center gap-1 rounded-md bg-slate-900 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-black"
            >
              <Pencil size={11} />
              Guardar
            </button>
          </div>
        )}

        {showCreatePanel && (
          <div className="grid grid-cols-[1fr_auto] gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2">
            <input
              type="text"
              value={newListName}
              onChange={event => setNewListName(event.target.value)}
              placeholder="Nueva lista de correos"
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => {
                void onCreateRecipientList(newListName).then(() => {
                  setNewListName('');
                  setShowCreatePanel(false);
                });
              }}
              className="inline-flex items-center justify-center gap-1 rounded-md bg-teal-600 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-teal-700"
            >
              <ChevronDown size={11} className="rotate-[-90deg]" />
              Crear
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-3">
          {safeRecipients.length > maxVisibleRecipients && !showBulkEditor && (
            <button
              onClick={onToggleShowAllRecipients}
              className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 underline underline-offset-2"
            >
              {showAllRecipients ? 'Ocultar lista' : `Mostrar todos (${safeRecipients.length})`}
            </button>
          )}
          <button
            onClick={onToggleBulkEditor}
            className="text-[10px] font-semibold text-slate-500 hover:text-slate-800"
          >
            {showBulkEditor ? '← Edición individual' : 'Edición masiva'}
          </button>
        </div>
      </div>

      {showBulkEditor ? (
        <div className="space-y-1.5">
          <textarea
            value={bulkRecipients}
            onChange={event => onBulkRecipientsChange(event.target.value)}
            rows={3}
            className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            placeholder="ejemplo1@hospital.cl&#10;ejemplo2@hospital.cl"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={onBulkCancel}
              className="px-2 py-1 rounded-lg border border-slate-200 text-slate-600 text-[10px] font-semibold hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              onClick={onBulkSave}
              className="px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-[10px] font-bold shadow-sm"
            >
              Guardar
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1 min-h-[34px] p-1.5 bg-slate-50/50 rounded-lg border border-slate-100">
            {safeRecipients.length === 0 && (
              <p className="text-[10px] text-slate-400 italic px-2 py-1">
                No hay destinatarios configurados.
              </p>
            )}
            {visibleRecipients.map((email, index) => (
              <div
                key={`${email}-${index}`}
                className="flex items-center gap-1 bg-white border border-slate-200 rounded-full pl-2 pr-1 py-0.5 text-[10px] font-medium text-slate-700 shadow-sm"
              >
                {editingIndex === index ? (
                  <input
                    type="email"
                    value={editingValue}
                    onChange={event => onEditingValueChange(event.target.value)}
                    onBlur={onSaveEditedRecipient}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        onSaveEditedRecipient();
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        onCancelEditRecipient();
                      }
                    }}
                    autoFocus
                    className="text-[10px] px-1 py-0 border-none focus:ring-0 bg-transparent w-full font-medium"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onStartEditRecipient(index)}
                    className="text-left focus:outline-none hover:text-blue-600 transition-colors truncate max-w-[108px]"
                    title={email}
                  >
                    {email}
                  </button>
                )}
                <button
                  onClick={() => onRemoveRecipient(index)}
                  className="p-0.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-all"
                  aria-label={`Eliminar ${email}`}
                >
                  <X size={9} />
                </button>
              </div>
            ))}
            {hiddenRecipientsCount > 0 && (
              <div className="text-[9px] text-slate-400 px-2 py-1 font-bold italic self-center">
                + {hiddenRecipientsCount}
              </div>
            )}
          </div>

          <div className="relative">
            <input
              type="email"
              placeholder="Agregar correo..."
              value={newRecipient}
              onChange={event => onNewRecipientChange(event.target.value)}
              onKeyDown={event => event.key === 'Enter' && onAddRecipient()}
              className="w-full border border-slate-200 rounded-lg pl-3 pr-9 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
            <button
              onClick={onAddRecipient}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 transition-all"
            >
              <Plus size={12} />
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-[9px] text-red-600 mt-1 font-medium px-1">✕ {error}</p>}
    </ModalSection>
  );
};
