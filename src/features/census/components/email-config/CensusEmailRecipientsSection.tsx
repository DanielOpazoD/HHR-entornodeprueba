import React from 'react';
import { Plus, Users, X } from 'lucide-react';
import { ModalSection } from '@/components/shared/BaseModal';

interface CensusEmailRecipientsSectionProps {
  safeRecipients: string[];
  visibleRecipients: string[];
  hiddenRecipientsCount: number;
  maxVisibleRecipients: number;
  showAllRecipients: boolean;
  showBulkEditor: boolean;
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
}) => (
  <ModalSection
    title="Destinatarios"
    icon={<Users size={16} className="text-blue-600" />}
    variant="info"
  >
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-3">
        {safeRecipients.length > maxVisibleRecipients && !showBulkEditor && (
          <button
            onClick={onToggleShowAllRecipients}
            className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 underline underline-offset-4"
          >
            {showAllRecipients ? 'Ocultar lista' : `Mostrar todos (${safeRecipients.length})`}
          </button>
        )}
        <button
          onClick={onToggleBulkEditor}
          className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
        >
          {showBulkEditor ? '← Edición individual' : 'Edición masiva'}
        </button>
      </div>
    </div>

    {showBulkEditor ? (
      <div className="space-y-2">
        <textarea
          value={bulkRecipients}
          onChange={event => onBulkRecipientsChange(event.target.value)}
          rows={4}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          placeholder="ejemplo1@hospital.cl&#10;ejemplo2@hospital.cl"
        />
        <div className="flex gap-2 justify-end">
          <button
            onClick={onBulkCancel}
            className="px-2 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={onBulkSave}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm"
          >
            Guardar
          </button>
        </div>
      </div>
    ) : (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5 min-h-[40px] p-2 bg-slate-50/50 rounded-xl border border-slate-100">
          {safeRecipients.length === 0 && (
            <p className="text-[11px] text-slate-400 italic px-2 py-1">
              No hay destinatarios configurados.
            </p>
          )}
          {visibleRecipients.map((email, index) => (
            <div
              key={`${email}-${index}`}
              className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-full pl-2.5 pr-1 py-0.5 text-[10.5px] font-medium text-slate-700 shadow-sm"
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
                  className="text-[10.5px] px-1 py-0 border-none focus:ring-0 bg-transparent w-full font-medium"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onStartEditRecipient(index)}
                  className="text-left focus:outline-none hover:text-blue-600 transition-colors truncate max-w-[120px]"
                  title={email}
                >
                  {email}
                </button>
              )}
              <button
                onClick={() => onRemoveRecipient(index)}
                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-all"
                aria-label={`Eliminar ${email}`}
              >
                <X size={10} />
              </button>
            </div>
          ))}
          {hiddenRecipientsCount > 0 && (
            <div className="text-[10px] text-slate-400 px-2 py-1 font-bold italic self-center">
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
            className="w-full border border-slate-200 rounded-xl pl-4 pr-10 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          <button
            onClick={onAddRecipient}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-all"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
    )}
    {error && <p className="text-[10px] text-red-600 mt-1 font-medium px-2">✕ {error}</p>}
  </ModalSection>
);
