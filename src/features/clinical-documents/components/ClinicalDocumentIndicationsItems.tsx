import React from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';

import type { ClinicalDocumentIndicationCatalogItem } from '@/features/clinical-documents/services/clinicalDocumentIndicationsCatalogService';

interface ClinicalDocumentIndicationsItemsProps {
  items: ClinicalDocumentIndicationCatalogItem[];
  canEdit: boolean;
  isSavingCustomIndication: boolean;
  editingItemId: string | null;
  editingText: string;
  onChangeEditingText: (value: string) => void;
  onInsertIndication: (text: string) => void;
  onStartEditing: (item: ClinicalDocumentIndicationCatalogItem) => void;
  onSaveEdit: (itemId: string) => void;
  onCancelEdit: () => void;
  onDeleteIndication: (itemId: string) => void;
}

export const ClinicalDocumentIndicationsItems: React.FC<ClinicalDocumentIndicationsItemsProps> = ({
  items,
  canEdit,
  isSavingCustomIndication,
  editingItemId,
  editingText,
  onChangeEditingText,
  onInsertIndication,
  onStartEditing,
  onSaveEdit,
  onCancelEdit,
  onDeleteIndication,
}) => (
  <div className="clinical-document-indications-list">
    {items.length > 0 ? (
      items.map((item: ClinicalDocumentIndicationCatalogItem) => {
        const isEditing = editingItemId === item.id;

        return (
          <div key={item.id} className="clinical-document-indications-item">
            {isEditing ? (
              <textarea
                value={editingText}
                onChange={event => onChangeEditingText(event.target.value)}
                rows={3}
                className="clinical-document-indications-item-editor"
                disabled={!canEdit || isSavingCustomIndication}
              />
            ) : (
              <div className="clinical-document-indications-item-row">
                <button
                  type="button"
                  className="clinical-document-indications-item-insert"
                  onClick={() => onInsertIndication(item.text)}
                  disabled={!canEdit}
                >
                  <span>{item.text}</span>
                </button>

                <div className="clinical-document-indications-item-meta">
                  <div className="clinical-document-indications-item-actions">
                    <button
                      type="button"
                      className="clinical-document-inline-action clinical-document-inline-action--compact"
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => onStartEditing(item)}
                      disabled={!canEdit || isSavingCustomIndication}
                      aria-label={`Editar indicación ${item.text}`}
                      title="Editar"
                    >
                      <Pencil size={10} />
                    </button>
                    <button
                      type="button"
                      className="clinical-document-inline-action clinical-document-inline-action--compact clinical-document-inline-action--danger"
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => onDeleteIndication(item.id)}
                      disabled={!canEdit || isSavingCustomIndication}
                      aria-label={`Eliminar indicación ${item.text}`}
                      title="Eliminar"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
              </div>
            )}
            {isEditing && (
              <div className="clinical-document-indications-item-meta">
                <div className="clinical-document-indications-item-actions">
                  <button
                    type="button"
                    className="clinical-document-inline-action clinical-document-inline-action--compact"
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => onSaveEdit(item.id)}
                    disabled={!canEdit || isSavingCustomIndication || !editingText.trim()}
                    aria-label={`Guardar indicación ${item.text}`}
                    title="Guardar"
                  >
                    <Check size={10} />
                  </button>
                  <button
                    type="button"
                    className="clinical-document-inline-action clinical-document-inline-action--compact"
                    onMouseDown={event => event.preventDefault()}
                    onClick={onCancelEdit}
                    aria-label={`Cancelar edición de ${item.text}`}
                    title="Cancelar"
                  >
                    <X size={10} />
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })
    ) : (
      <p className="clinical-document-indications-empty">
        No hay indicaciones guardadas en tu cuenta.
      </p>
    )}
  </div>
);
